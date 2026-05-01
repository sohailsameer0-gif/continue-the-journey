CREATE OR REPLACE FUNCTION public.set_bill_request_outlet_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.outlet_id IS NULL THEN
    SELECT outlet_id INTO NEW.outlet_id
    FROM public.orders
    WHERE id = NEW.order_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_bill_request_outlet_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_bill_request_outlet_id() FROM anon;
REVOKE ALL ON FUNCTION public.set_bill_request_outlet_id() FROM authenticated;