-- 1) Subscription history table for plan timeline
CREATE TABLE IF NOT EXISTS public.subscription_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL,
  subscription_id uuid,
  event_type text NOT NULL, -- 'plan_change','status_change','extended','expired','suspended','reactivated','created'
  from_plan text,
  to_plan text,
  from_status text,
  to_status text,
  from_paid_until timestamptz,
  to_paid_until timestamptz,
  from_demo_end_date timestamptz,
  to_demo_end_date timestamptz,
  actor_id uuid,
  actor_email text,
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_history_outlet ON public.subscription_history(outlet_id, created_at DESC);

ALTER TABLE public.subscription_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage subscription history"
  ON public.subscription_history
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Owner reads own subscription history"
  ON public.subscription_history
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.outlets WHERE outlets.id = subscription_history.outlet_id AND outlets.owner_id = auth.uid()));

-- 2) Trigger to log every change to subscriptions table
CREATE OR REPLACE FUNCTION public.log_subscription_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v_event text;
BEGIN
  IF v_actor IS NOT NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = v_actor;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.subscription_history (outlet_id, subscription_id, event_type, to_plan, to_status, to_paid_until, to_demo_end_date, actor_id, actor_email)
    VALUES (NEW.outlet_id, NEW.id, 'created', NEW.plan::text, NEW.status::text, NEW.paid_until, NEW.demo_end_date, v_actor, v_email);
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.plan IS DISTINCT FROM OLD.plan THEN
    INSERT INTO public.subscription_history (outlet_id, subscription_id, event_type, from_plan, to_plan, from_status, to_status, actor_id, actor_email)
    VALUES (NEW.outlet_id, NEW.id, 'plan_change', OLD.plan::text, NEW.plan::text, OLD.status::text, NEW.status::text, v_actor, v_email);
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.plan IS NOT DISTINCT FROM OLD.plan THEN
    v_event := CASE
      WHEN NEW.status::text = 'suspended' THEN 'suspended'
      WHEN OLD.status::text = 'suspended' THEN 'reactivated'
      WHEN NEW.status::text = 'expired' THEN 'expired'
      ELSE 'status_change'
    END;
    INSERT INTO public.subscription_history (outlet_id, subscription_id, event_type, from_status, to_status, actor_id, actor_email)
    VALUES (NEW.outlet_id, NEW.id, v_event, OLD.status::text, NEW.status::text, v_actor, v_email);
  END IF;

  IF NEW.paid_until IS DISTINCT FROM OLD.paid_until AND NEW.plan IS NOT DISTINCT FROM OLD.plan THEN
    INSERT INTO public.subscription_history (outlet_id, subscription_id, event_type, from_paid_until, to_paid_until, actor_id, actor_email)
    VALUES (NEW.outlet_id, NEW.id, 'extended', OLD.paid_until, NEW.paid_until, v_actor, v_email);
  END IF;

  IF NEW.demo_end_date IS DISTINCT FROM OLD.demo_end_date AND NEW.plan IS NOT DISTINCT FROM OLD.plan THEN
    INSERT INTO public.subscription_history (outlet_id, subscription_id, event_type, from_demo_end_date, to_demo_end_date, actor_id, actor_email)
    VALUES (NEW.outlet_id, NEW.id, 'extended', OLD.demo_end_date, NEW.demo_end_date, v_actor, v_email);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_subscription_history ON public.subscriptions;
CREATE TRIGGER trg_log_subscription_history
AFTER INSERT OR UPDATE ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.log_subscription_history();

-- 3) Trigger to send outlet message + log history when outlet is suspended/reactivated with reason
CREATE OR REPLACE FUNCTION public.notify_outlet_on_suspension()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF NEW.suspended IS DISTINCT FROM OLD.suspended THEN
    IF NEW.suspended = true THEN
      INSERT INTO public.outlet_messages (outlet_id, kind, title, body, metadata, created_by)
      VALUES (
        NEW.id,
        'outlet_suspended',
        'Your outlet has been suspended',
        COALESCE('Reason: ' || NEW.suspended_reason, 'Your outlet access has been temporarily suspended. Please contact support.'),
        jsonb_build_object('reason', NEW.suspended_reason),
        v_actor
      );
    ELSE
      INSERT INTO public.outlet_messages (outlet_id, kind, title, body, metadata, created_by)
      VALUES (
        NEW.id,
        'outlet_reactivated',
        'Your outlet has been reactivated',
        'Your outlet is now active again. Thank you for your patience.',
        '{}'::jsonb,
        v_actor
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_outlet_on_suspension ON public.outlets;
CREATE TRIGGER trg_notify_outlet_on_suspension
AFTER UPDATE OF suspended ON public.outlets
FOR EACH ROW EXECUTE FUNCTION public.notify_outlet_on_suspension();