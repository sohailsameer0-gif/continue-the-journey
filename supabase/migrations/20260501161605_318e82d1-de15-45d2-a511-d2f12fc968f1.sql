
-- 1. Add the missing column that the AdminSettings UI tries to save
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS auto_approve_subscriptions boolean NOT NULL DEFAULT false;

-- 2. Trigger: when a plan_request is inserted with status='pending'
--    and auto_approve_subscriptions is ON, immediately approve it.
CREATE OR REPLACE FUNCTION public.auto_approve_plan_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auto boolean;
  v_existing_paid_until timestamptz;
  v_new_paid_until timestamptz;
  v_outlet_name text;
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT auto_approve_subscriptions INTO v_auto
    FROM public.platform_settings LIMIT 1;

  IF COALESCE(v_auto, false) = false THEN
    RETURN NEW;
  END IF;

  SELECT paid_until INTO v_existing_paid_until
    FROM public.subscriptions WHERE outlet_id = NEW.outlet_id;

  IF v_existing_paid_until IS NOT NULL AND v_existing_paid_until > now() THEN
    v_new_paid_until := v_existing_paid_until + interval '30 days';
  ELSE
    v_new_paid_until := now() + interval '30 days';
  END IF;

  SELECT name INTO v_outlet_name FROM public.outlets WHERE id = NEW.outlet_id;

  -- Mark the request approved
  NEW.status := 'approved';
  NEW.admin_note := COALESCE(NEW.admin_note, 'Auto-approved by system');
  NEW.updated_at := now();

  -- Activate subscription
  INSERT INTO public.subscriptions (outlet_id, plan, status, paid_until)
  VALUES (NEW.outlet_id, NEW.requested_plan::subscription_plan, 'paid_active', v_new_paid_until)
  ON CONFLICT (outlet_id) DO UPDATE
    SET plan = EXCLUDED.plan,
        status = 'paid_active',
        paid_until = EXCLUDED.paid_until,
        updated_at = now();

  -- Notify outlet
  INSERT INTO public.outlet_messages (outlet_id, kind, title, body, metadata)
  VALUES (
    NEW.outlet_id,
    'subscription_approved',
    'Subscription auto-approved',
    'Your ' || NEW.requested_plan || ' plan has been activated. Renews ' || to_char(v_new_paid_until, 'DD Mon YYYY') || '.',
    jsonb_build_object('plan', NEW.requested_plan, 'paid_until', v_new_paid_until, 'auto', true, 'request_id', NEW.id)
  );

  -- Audit
  INSERT INTO public.activity_logs (actor_id, actor_email, action, entity_type, entity_id, entity_label, metadata)
  VALUES (
    NEW.outlet_id, -- system actor (use outlet id as placeholder)
    'system@auto-approve',
    'subscription.approved',
    'subscription',
    NEW.outlet_id,
    v_outlet_name,
    jsonb_build_object('request_id', NEW.id, 'plan', NEW.requested_plan, 'paid_until', v_new_paid_until, 'auto', true)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_approve_plan_request ON public.plan_requests;
CREATE TRIGGER trg_auto_approve_plan_request
  BEFORE INSERT ON public.plan_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_approve_plan_request();
