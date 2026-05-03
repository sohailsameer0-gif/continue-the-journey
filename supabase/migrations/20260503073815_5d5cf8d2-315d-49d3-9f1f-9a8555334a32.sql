
CREATE OR REPLACE FUNCTION public.customer_cancel_orders(
  _order_ids uuid[],
  _session_id text,
  _reason text,
  _details text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_outlet_id uuid;
  v_customer text;
  v_table text;
BEGIN
  IF _order_ids IS NULL OR array_length(_order_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'No orders');
  END IF;
  IF _session_id IS NULL OR length(_session_id) < 4 THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Invalid session');
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Reason required');
  END IF;

  UPDATE public.orders
     SET status = 'cancelled',
         cancellation_reason = _reason,
         cancellation_reason_text = NULLIF(trim(coalesce(_details,'')), ''),
         cancelled_by = 'customer',
         cancelled_at = now(),
         updated_at = now()
   WHERE id = ANY(_order_ids)
     AND session_id = _session_id
     AND status IN ('pending','accepted')
     AND payment_status <> 'paid';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'message', 'No cancellable orders found');
  END IF;

  SELECT o.outlet_id, COALESCE(NULLIF(o.customer_name,''), 'Customer'), t.table_number
    INTO v_outlet_id, v_customer, v_table
    FROM public.orders o
    LEFT JOIN public.tables t ON t.id = o.table_id
   WHERE o.id = _order_ids[1];

  INSERT INTO public.outlet_messages (outlet_id, kind, title, body, metadata)
  VALUES (
    v_outlet_id,
    'order_cancelled',
    '❌ Order cancelled by customer',
    COALESCE(v_customer,'Customer') ||
      CASE WHEN v_table IS NOT NULL THEN ' (Table ' || v_table || ')' ELSE '' END ||
      ' ne order cancel kar diya. Reason: ' || _reason ||
      COALESCE(' — ' || NULLIF(trim(coalesce(_details,'')),''), ''),
    jsonb_build_object('order_ids', _order_ids, 'reason', _reason, 'details', _details)
  );

  RETURN jsonb_build_object('ok', true, 'count', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.customer_cancel_orders(uuid[], text, text, text) TO anon, authenticated;
