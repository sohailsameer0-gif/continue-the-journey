-- File: outlet suspension enforcement
CREATE OR REPLACE FUNCTION public.is_outlet_active(_outlet_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.outlets
    WHERE id = _outlet_id AND suspended = false
      AND approval_status = 'approved' AND is_active = true
  );
$fn$;

CREATE OR REPLACE FUNCTION public.owns_active_outlet(_outlet_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.outlets
    WHERE id = _outlet_id AND owner_id = auth.uid()
      AND suspended = false AND approval_status = 'approved' AND is_active = true
  );
$fn$;

DROP POLICY IF EXISTS "Owners manage own outlet" ON public.outlets;
CREATE POLICY "Owners read own outlet" ON public.outlets FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "Owners insert own outlet" ON public.outlets FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Active owners update own outlet" ON public.outlets FOR UPDATE
  USING (auth.uid() = owner_id AND suspended = false)
  WITH CHECK (auth.uid() = owner_id AND suspended = false);
CREATE POLICY "Owners delete own outlet" ON public.outlets FOR DELETE
  USING (auth.uid() = owner_id AND suspended = false);

DROP POLICY IF EXISTS "Owner manages categories" ON public.menu_categories;
CREATE POLICY "Active owner manages categories" ON public.menu_categories FOR ALL
  USING (public.owns_active_outlet(outlet_id)) WITH CHECK (public.owns_active_outlet(outlet_id));

DROP POLICY IF EXISTS "Owner manages items" ON public.menu_items;
CREATE POLICY "Active owner manages items" ON public.menu_items FOR ALL
  USING (public.owns_active_outlet(outlet_id)) WITH CHECK (public.owns_active_outlet(outlet_id));

DROP POLICY IF EXISTS "Owner manages tables" ON public.tables;
CREATE POLICY "Active owner manages tables" ON public.tables FOR ALL
  USING (public.owns_active_outlet(outlet_id)) WITH CHECK (public.owns_active_outlet(outlet_id));

DROP POLICY IF EXISTS "Owner manages settings" ON public.outlet_settings;
CREATE POLICY "Active owner manages settings" ON public.outlet_settings FOR ALL
  USING (public.owns_active_outlet(outlet_id)) WITH CHECK (public.owns_active_outlet(outlet_id));

DROP POLICY IF EXISTS "Owner manages orders" ON public.orders;
CREATE POLICY "Active owner manages orders" ON public.orders FOR ALL
  USING (public.owns_active_outlet(outlet_id)) WITH CHECK (public.owns_active_outlet(outlet_id));

DROP POLICY IF EXISTS "Owner manages payments" ON public.payments;
CREATE POLICY "Active owner manages payments" ON public.payments FOR ALL
  USING (public.owns_active_outlet(outlet_id)) WITH CHECK (public.owns_active_outlet(outlet_id));

CREATE OR REPLACE FUNCTION public.sync_subscription_on_outlet_suspend()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NEW.suspended IS DISTINCT FROM OLD.suspended THEN
    IF NEW.suspended = true THEN
      UPDATE public.subscriptions SET status = 'suspended', updated_at = now() WHERE outlet_id = NEW.id;
    ELSE
      UPDATE public.subscriptions
        SET status = CASE
              WHEN plan = 'free_demo' AND demo_end_date IS NOT NULL AND demo_end_date > now() THEN 'active'::subscription_status
              WHEN plan <> 'free_demo' AND paid_until IS NOT NULL AND paid_until > now() THEN 'paid_active'::subscription_status
              ELSE 'expired'::subscription_status
            END,
            updated_at = now()
        WHERE outlet_id = NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_sync_sub_on_outlet_suspend ON public.outlets;
CREATE TRIGGER trg_sync_sub_on_outlet_suspend
  AFTER UPDATE OF suspended ON public.outlets
  FOR EACH ROW EXECUTE FUNCTION public.sync_subscription_on_outlet_suspend();

-- File: pgcrypto + recreate OTP functions using extensions.digest
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.admin_approve_outlet(_outlet_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $fn$
DECLARE v_code text; v_hash text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  v_code := public._gen_otp_code();
  v_hash := encode(extensions.digest(v_code, 'sha256'), 'hex');
  INSERT INTO public.outlet_access (outlet_id, status, otp_code_hash, otp_plain_for_admin, otp_expires_at, otp_attempts, approved_by, approved_at)
  VALUES (_outlet_id, 'approved', v_hash, v_code, now() + interval '24 hours', 0, auth.uid(), now())
  ON CONFLICT (outlet_id) DO UPDATE
    SET status = 'approved', otp_code_hash = EXCLUDED.otp_code_hash, otp_plain_for_admin = EXCLUDED.otp_plain_for_admin,
        otp_expires_at = EXCLUDED.otp_expires_at, otp_attempts = 0, approved_by = auth.uid(), approved_at = now(),
        rejected_reason = NULL, blocked_at = NULL, updated_at = now();
  RETURN jsonb_build_object('ok', true, 'code', v_code, 'expires_at', (now() + interval '24 hours'));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_regenerate_outlet_otp(_outlet_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $fn$
DECLARE v_code text; v_hash text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  v_code := public._gen_otp_code();
  v_hash := encode(extensions.digest(v_code, 'sha256'), 'hex');
  UPDATE public.outlet_access
     SET status = 'approved', otp_code_hash = v_hash, otp_plain_for_admin = v_code,
         otp_expires_at = now() + interval '24 hours', otp_attempts = 0, blocked_at = NULL,
         approved_by = auth.uid(), approved_at = now(), updated_at = now()
   WHERE outlet_id = _outlet_id;
  RETURN jsonb_build_object('ok', true, 'code', v_code, 'expires_at', (now() + interval '24 hours'));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.verify_outlet_otp(_code text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $fn$
DECLARE v_outlet_id uuid; v_row public.outlet_access%ROWTYPE; v_hash text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id INTO v_outlet_id FROM public.outlets WHERE owner_id = auth.uid() LIMIT 1;
  IF v_outlet_id IS NULL THEN RAISE EXCEPTION 'No outlet for current user'; END IF;
  SELECT * INTO v_row FROM public.outlet_access WHERE outlet_id = v_outlet_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Access record not found'; END IF;
  IF v_row.status = 'verified' THEN RETURN jsonb_build_object('ok', true, 'already_verified', true); END IF;
  IF v_row.status = 'blocked' THEN RETURN jsonb_build_object('ok', false, 'error', 'blocked'); END IF;
  IF v_row.status = 'rejected' THEN RETURN jsonb_build_object('ok', false, 'error', 'rejected'); END IF;
  IF v_row.status = 'pending' THEN RETURN jsonb_build_object('ok', false, 'error', 'pending'); END IF;
  IF v_row.otp_expires_at IS NULL OR v_row.otp_expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;
  v_hash := encode(extensions.digest(_code, 'sha256'), 'hex');
  IF v_row.otp_code_hash = v_hash THEN
    UPDATE public.outlet_access
       SET status = 'verified', verified_at = now(), otp_code_hash = NULL,
           otp_plain_for_admin = NULL, otp_expires_at = NULL, otp_attempts = 0, updated_at = now()
     WHERE outlet_id = v_outlet_id;
    RETURN jsonb_build_object('ok', true);
  ELSE
    UPDATE public.outlet_access
       SET otp_attempts = otp_attempts + 1,
           status = CASE WHEN otp_attempts + 1 >= otp_max_attempts THEN 'blocked'::public.outlet_access_status ELSE status END,
           blocked_at = CASE WHEN otp_attempts + 1 >= otp_max_attempts THEN now() ELSE blocked_at END,
           updated_at = now()
     WHERE outlet_id = v_outlet_id
     RETURNING * INTO v_row;
    IF v_row.status = 'blocked' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'blocked');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'invalid',
      'attempts_left', GREATEST(v_row.otp_max_attempts - v_row.otp_attempts, 0));
  END IF;
END;
$fn$;

-- File: support contact fields
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS support_whatsapp text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS support_email text NOT NULL DEFAULT '';