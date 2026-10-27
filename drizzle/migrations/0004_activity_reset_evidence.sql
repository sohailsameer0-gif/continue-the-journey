-- Evidence image for activity resets
ALTER TABLE public.outlet_activity_resets
  ADD COLUMN IF NOT EXISTS evidence_url text;

-- New 4-arg RPC (evidence url optional)
CREATE OR REPLACE FUNCTION public.admin_reset_outlet_activity(_outlet_id uuid, _types text[], _reason text, _evidence_url text DEFAULT NULL)
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
  INSERT INTO public.outlet_activity_resets (outlet_id, cleared_types, reason, reset_by, reset_by_email, counts, evidence_url)
  VALUES (_outlet_id, _types, _reason, v_actor, v_email, v_counts, _evidence_url);
  INSERT INTO public.activity_logs (actor_id, actor_email, action, entity_type, entity_id, entity_label, metadata)
  VALUES (v_actor, v_email, 'outlet.activity_reset', 'outlet', _outlet_id, v_outlet_name,
          jsonb_build_object('types', _types, 'reason', _reason, 'counts', v_counts, 'evidence_url', _evidence_url));
  RETURN jsonb_build_object('ok', true, 'counts', v_counts);
END;
$fn$;

-- Remove the old 3-arg overload
DROP FUNCTION IF EXISTS public.admin_reset_outlet_activity(uuid, text[], text);
REVOKE ALL ON FUNCTION public.admin_reset_outlet_activity(uuid, text[], text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_reset_outlet_activity(uuid, text[], text, text) TO authenticated;

-- Storage policies for the reset-evidence bucket (admin-only, private)
DROP POLICY IF EXISTS "Admins manage reset-evidence" ON storage.objects;
CREATE POLICY "Admins manage reset-evidence" ON storage.objects FOR ALL
  USING (bucket_id = 'reset-evidence' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'reset-evidence' AND public.has_role(auth.uid(), 'admin'));
