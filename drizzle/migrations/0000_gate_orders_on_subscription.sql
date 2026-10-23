-- Enforce subscription/suspension state at order creation time (server-side).
-- Blocks INSERT on public.orders when the outlet is suspended, not active,
-- or its subscription (paid or free demo) has expired. Admins are exempt.
CREATE OR REPLACE FUNCTION public.fn_gate_order_on_subscription()
RETURNS trigger
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_outlet public.outlets%ROWTYPE;
  v_sub public.subscriptions%ROWTYPE;
BEGIN
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_outlet FROM public.outlets WHERE id = NEW.outlet_id;
  IF NOT FOUND
     OR v_outlet.suspended
     OR NOT v_outlet.is_active
     OR v_outlet.approval_status <> 'approved' THEN
    RAISE EXCEPTION 'This outlet is not accepting orders right now.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_sub FROM public.subscriptions WHERE outlet_id = NEW.outlet_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This outlet is not accepting orders right now.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_sub.status IN ('suspended', 'expired') THEN
    RAISE EXCEPTION 'This outlet subscription has expired. New orders are disabled.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_sub.status = 'paid_active'
     AND v_sub.paid_until IS NOT NULL
     AND v_sub.paid_until < now() THEN
    RAISE EXCEPTION 'This outlet subscription has expired. New orders are disabled.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_sub.status = 'active'
     AND v_sub.demo_end_date IS NOT NULL
     AND v_sub.demo_end_date < now() THEN
    RAISE EXCEPTION 'This outlet free trial has expired. New orders are disabled.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gate_order_subscription ON public.orders;
CREATE TRIGGER trg_gate_order_subscription
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.fn_gate_order_on_subscription();

-- Public UI helper: can this outlet accept orders right now?
CREATE OR REPLACE FUNCTION public.get_outlet_order_gate(_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_outlet public.outlets%ROWTYPE;
  v_sub public.subscriptions%ROWTYPE;
BEGIN
  SELECT * INTO v_outlet FROM public.outlets WHERE slug = _slug AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('can_order', false, 'reason', 'not_found');
  END IF;

  IF v_outlet.suspended THEN
    RETURN jsonb_build_object('can_order', false, 'reason', 'suspended');
  END IF;
  IF v_outlet.approval_status <> 'approved' THEN
    RETURN jsonb_build_object('can_order', false, 'reason', 'inactive');
  END IF;

  SELECT * INTO v_sub FROM public.subscriptions WHERE outlet_id = v_outlet.id;
  IF NOT FOUND
     OR v_sub.status IN ('suspended', 'expired')
     OR (v_sub.status = 'paid_active' AND v_sub.paid_until IS NOT NULL AND v_sub.paid_until < now())
     OR (v_sub.status = 'active' AND v_sub.demo_end_date IS NOT NULL AND v_sub.demo_end_date < now()) THEN
    RETURN jsonb_build_object('can_order', false, 'reason', 'expired');
  END IF;

  RETURN jsonb_build_object('can_order', true, 'reason', 'ok');
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_outlet_order_gate(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_outlet_order_gate(text) TO service_role;
