-- 1) admin_payment_methods
CREATE TABLE IF NOT EXISTS public.admin_payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL DEFAULT 'bank_transfer',
  label text NOT NULL,
  account_title text, account_number text, iban text, bank_name text,
  instructions text, qr_image_url text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_payment_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage payment methods" ON public.admin_payment_methods;
CREATE POLICY "Admins manage payment methods" ON public.admin_payment_methods
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Public can view active payment methods" ON public.admin_payment_methods;
CREATE POLICY "Public can view active payment methods" ON public.admin_payment_methods
  FOR SELECT USING (is_active = true OR public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS trg_admin_payment_methods_updated_at ON public.admin_payment_methods;
CREATE TRIGGER trg_admin_payment_methods_updated_at
  BEFORE UPDATE ON public.admin_payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('admin-payment-qr', 'admin-payment-qr', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read admin-payment-qr" ON storage.objects;
CREATE POLICY "Public read admin-payment-qr" ON storage.objects FOR SELECT
  USING (bucket_id = 'admin-payment-qr');

DROP POLICY IF EXISTS "Admins manage admin-payment-qr" ON storage.objects;
CREATE POLICY "Admins manage admin-payment-qr" ON storage.objects FOR ALL
  USING (bucket_id = 'admin-payment-qr' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'admin-payment-qr' AND public.has_role(auth.uid(), 'admin'));

-- 3) outlet_activity_resets
CREATE TABLE IF NOT EXISTS public.outlet_activity_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL,
  cleared_types text[] NOT NULL DEFAULT '{}',
  reason text NOT NULL,
  reset_by uuid, reset_by_email text,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.outlet_activity_resets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage activity resets" ON public.outlet_activity_resets;
CREATE POLICY "Admins manage activity resets" ON public.outlet_activity_resets
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Owner reads own activity resets" ON public.outlet_activity_resets;
CREATE POLICY "Owner reads own activity resets" ON public.outlet_activity_resets
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.outlets WHERE outlets.id = outlet_activity_resets.outlet_id AND outlets.owner_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_outlet_activity_resets_outlet ON public.outlet_activity_resets(outlet_id, created_at DESC);

-- 4) outlet_messages
CREATE TABLE IF NOT EXISTS public.outlet_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'admin_message',
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz, created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.outlet_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage outlet messages" ON public.outlet_messages;
CREATE POLICY "Admins manage outlet messages" ON public.outlet_messages
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Owner reads own outlet messages" ON public.outlet_messages;
CREATE POLICY "Owner reads own outlet messages" ON public.outlet_messages
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.outlets WHERE outlets.id = outlet_messages.outlet_id AND outlets.owner_id = auth.uid()));

DROP POLICY IF EXISTS "Owner updates own outlet messages" ON public.outlet_messages;
CREATE POLICY "Owner updates own outlet messages" ON public.outlet_messages
  FOR UPDATE USING (EXISTS (SELECT 1 FROM public.outlets WHERE outlets.id = outlet_messages.outlet_id AND outlets.owner_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_outlet_messages_outlet ON public.outlet_messages(outlet_id, created_at DESC);

-- 5) Add 'cancelled' to order_status enum (own statement; safe in non-extension functions)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'cancelled' AND enumtypid = 'public.order_status'::regtype) THEN
    ALTER TYPE public.order_status ADD VALUE 'cancelled';
  END IF;
END $$;

-- 6) Cancellation columns on orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS cancellation_reason_text text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by text;

-- 7) outlet_staff + assignment columns
CREATE TABLE IF NOT EXISTS public.outlet_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL REFERENCES public.outlets(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('rider','waiter')),
  name text NOT NULL,
  phone text DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outlet_staff_outlet ON public.outlet_staff(outlet_id);
ALTER TABLE public.outlet_staff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner manages staff" ON public.outlet_staff;
CREATE POLICY "Owner manages staff" ON public.outlet_staff FOR ALL
  USING (EXISTS (SELECT 1 FROM public.outlets WHERE outlets.id = outlet_staff.outlet_id AND outlets.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.outlets WHERE outlets.id = outlet_staff.outlet_id AND outlets.owner_id = auth.uid()));

DROP POLICY IF EXISTS "Admins read staff" ON public.outlet_staff;
CREATE POLICY "Admins read staff" ON public.outlet_staff
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS update_outlet_staff_updated_at ON public.outlet_staff;
CREATE TRIGGER update_outlet_staff_updated_at
  BEFORE UPDATE ON public.outlet_staff
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS rider_id uuid REFERENCES public.outlet_staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS waiter_id uuid REFERENCES public.outlet_staff(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_rider ON public.orders(rider_id);
CREATE INDEX IF NOT EXISTS idx_orders_waiter ON public.orders(waiter_id);

-- 8) Fix _gen_otp_code search_path
CREATE OR REPLACE FUNCTION public._gen_otp_code()
 RETURNS text LANGUAGE plpgsql SET search_path TO 'public'
AS $fn$
DECLARE v_code text;
BEGIN
  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  RETURN v_code;
END;
$fn$;

-- 9) admin_reset_outlet_activity
CREATE OR REPLACE FUNCTION public.admin_reset_outlet_activity(_outlet_id uuid, _types text[], _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_actor uuid := auth.uid(); v_email text; v_counts jsonb := '{}'::jsonb; v_n int; v_outlet_name text;
BEGIN
  IF NOT public.has_role(v_actor, 'admin') THEN RETURN jsonb_build_object('ok', false, 'message', 'Forbidden'); END IF;
  IF _outlet_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Outlet required'); END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN RETURN jsonb_build_object('ok', false, 'message', 'Reason required (min 3 chars)'); END IF;
  IF _types IS NULL OR array_length(_types, 1) IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Select at least one data type'); END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_actor;
  SELECT name INTO v_outlet_name FROM public.outlets WHERE id = _outlet_id;
  IF 'orders' = ANY(_types) THEN
    DELETE FROM public.bill_requests WHERE order_id IN (SELECT id FROM public.orders WHERE outlet_id = _outlet_id);
    DELETE FROM public.payment_proofs WHERE payment_id IN (SELECT id FROM public.payments WHERE outlet_id = _outlet_id);
    DELETE FROM public.payments WHERE outlet_id = _outlet_id;
    DELETE FROM public.order_items WHERE order_id IN (SELECT id FROM public.orders WHERE outlet_id = _outlet_id);
    DELETE FROM public.orders WHERE outlet_id = _outlet_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('orders', v_n);
  END IF;
  IF 'payments' = ANY(_types) AND NOT ('orders' = ANY(_types)) THEN
    DELETE FROM public.payment_proofs WHERE payment_id IN (SELECT id FROM public.payments WHERE outlet_id = _outlet_id);
    DELETE FROM public.payments WHERE outlet_id = _outlet_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('payments', v_n);
  END IF;
  IF 'plan_requests' = ANY(_types) THEN
    DELETE FROM public.plan_requests WHERE outlet_id = _outlet_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('plan_requests', v_n);
  END IF;
  IF 'activity_logs' = ANY(_types) THEN
    DELETE FROM public.activity_logs WHERE entity_id = _outlet_id
       OR entity_id IN (SELECT id FROM public.subscriptions WHERE outlet_id = _outlet_id);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('activity_logs', v_n);
  END IF;
  IF 'messages' = ANY(_types) THEN
    DELETE FROM public.outlet_messages WHERE outlet_id = _outlet_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('messages', v_n);
  END IF;
  IF 'resets' = ANY(_types) THEN
    DELETE FROM public.outlet_activity_resets WHERE outlet_id = _outlet_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('resets', v_n);
  END IF;
  INSERT INTO public.outlet_activity_resets (outlet_id, cleared_types, reason, reset_by, reset_by_email, counts)
  VALUES (_outlet_id, _types, _reason, v_actor, v_email, v_counts);
  INSERT INTO public.activity_logs (actor_id, actor_email, action, entity_type, entity_id, entity_label, metadata)
  VALUES (v_actor, v_email, 'outlet.activity_reset', 'outlet', _outlet_id, v_outlet_name,
          jsonb_build_object('types', _types, 'reason', _reason, 'counts', v_counts));
  RETURN jsonb_build_object('ok', true, 'counts', v_counts);
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_reset_outlet_activity(uuid, text[], text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_reset_outlet_activity(uuid, text[], text) TO authenticated;

-- 10) admin_approve_plan_request
CREATE OR REPLACE FUNCTION public.admin_approve_plan_request(_request_id uuid, _admin_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_actor uuid := auth.uid(); v_email text; v_req plan_requests%ROWTYPE; v_outlet_name text;
        v_new_paid_until timestamptz; v_existing_paid_until timestamptz;
BEGIN
  IF NOT public.has_role(v_actor, 'admin') THEN RETURN jsonb_build_object('ok', false, 'message', 'Forbidden'); END IF;
  SELECT * INTO v_req FROM public.plan_requests WHERE id = _request_id FOR UPDATE;
  IF v_req.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Request not found'); END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_actor;
  SELECT name INTO v_outlet_name FROM public.outlets WHERE id = v_req.outlet_id;
  SELECT paid_until INTO v_existing_paid_until FROM public.subscriptions WHERE outlet_id = v_req.outlet_id;
  IF v_existing_paid_until IS NOT NULL AND v_existing_paid_until > now() THEN
    v_new_paid_until := v_existing_paid_until + interval '30 days';
  ELSE v_new_paid_until := now() + interval '30 days'; END IF;
  UPDATE public.plan_requests SET status = 'approved', admin_note = COALESCE(_admin_note, admin_note), updated_at = now()
   WHERE id = _request_id;
  INSERT INTO public.subscriptions (outlet_id, plan, status, paid_until)
  VALUES (v_req.outlet_id, v_req.requested_plan::subscription_plan, 'paid_active', v_new_paid_until)
  ON CONFLICT (outlet_id) DO UPDATE
    SET plan = EXCLUDED.plan, status = 'paid_active',
        paid_until = EXCLUDED.paid_until, updated_at = now();
  INSERT INTO public.outlet_messages (outlet_id, kind, title, body, metadata, created_by)
  VALUES (v_req.outlet_id, 'subscription_approved', 'Subscription approved',
    'Your ' || v_req.requested_plan || ' plan has been activated. Renews ' || to_char(v_new_paid_until, 'DD Mon YYYY') || '.',
    jsonb_build_object('plan', v_req.requested_plan, 'paid_until', v_new_paid_until, 'request_id', _request_id), v_actor);
  INSERT INTO public.activity_logs (actor_id, actor_email, action, entity_type, entity_id, entity_label, metadata)
  VALUES (v_actor, v_email, 'subscription.approved', 'subscription', v_req.outlet_id, v_outlet_name,
    jsonb_build_object('request_id', _request_id, 'plan', v_req.requested_plan, 'paid_until', v_new_paid_until, 'amount', v_req.amount));
  RETURN jsonb_build_object('ok', true, 'plan', v_req.requested_plan, 'paid_until', v_new_paid_until);
END;
$fn$;

-- 11) admin_reject_plan_request
CREATE OR REPLACE FUNCTION public.admin_reject_plan_request(_request_id uuid, _admin_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_actor uuid := auth.uid(); v_email text; v_req plan_requests%ROWTYPE; v_outlet_name text;
BEGIN
  IF NOT public.has_role(v_actor, 'admin') THEN RETURN jsonb_build_object('ok', false, 'message', 'Forbidden'); END IF;
  SELECT * INTO v_req FROM public.plan_requests WHERE id = _request_id FOR UPDATE;
  IF v_req.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Request not found'); END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_actor;
  SELECT name INTO v_outlet_name FROM public.outlets WHERE id = v_req.outlet_id;
  UPDATE public.plan_requests SET status = 'rejected', admin_note = COALESCE(_admin_note, admin_note), updated_at = now()
   WHERE id = _request_id;
  INSERT INTO public.outlet_messages (outlet_id, kind, title, body, metadata, created_by)
  VALUES (v_req.outlet_id, 'subscription_rejected', 'Subscription request rejected',
    COALESCE('Reason: ' || _admin_note, 'Your subscription request was rejected. Please contact support.'),
    jsonb_build_object('plan', v_req.requested_plan, 'request_id', _request_id, 'admin_note', _admin_note), v_actor);
  INSERT INTO public.activity_logs (actor_id, actor_email, action, entity_type, entity_id, entity_label, metadata)
  VALUES (v_actor, v_email, 'subscription.rejected', 'subscription', v_req.outlet_id, v_outlet_name,
    jsonb_build_object('request_id', _request_id, 'plan', v_req.requested_plan, 'admin_note', _admin_note));
  RETURN jsonb_build_object('ok', true);
END;
$fn$;