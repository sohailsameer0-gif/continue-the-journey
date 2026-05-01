ALTER TABLE public.bill_requests
ADD COLUMN IF NOT EXISTS outlet_id uuid REFERENCES public.outlets(id) ON DELETE CASCADE;

UPDATE public.bill_requests br
SET outlet_id = o.outlet_id
FROM public.orders o
WHERE br.order_id = o.id
  AND br.outlet_id IS NULL;

CREATE OR REPLACE FUNCTION public.set_bill_request_outlet_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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

DROP TRIGGER IF EXISTS set_bill_request_outlet_id_before_insert ON public.bill_requests;
CREATE TRIGGER set_bill_request_outlet_id_before_insert
BEFORE INSERT ON public.bill_requests
FOR EACH ROW
EXECUTE FUNCTION public.set_bill_request_outlet_id();

CREATE INDEX IF NOT EXISTS idx_bill_requests_outlet_status_created
ON public.bill_requests(outlet_id, status, created_at DESC);

DROP POLICY IF EXISTS "Bill requests follow order access" ON public.bill_requests;
DROP POLICY IF EXISTS "Public can create bill requests" ON public.bill_requests;
DROP POLICY IF EXISTS "Owner manages bill requests" ON public.bill_requests;

CREATE POLICY "Public can view bill requests"
ON public.bill_requests
FOR SELECT
USING (true);

CREATE POLICY "Public can create bill requests for existing orders"
ON public.bill_requests
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.orders
    WHERE orders.id = bill_requests.order_id
      AND (bill_requests.outlet_id IS NULL OR orders.outlet_id = bill_requests.outlet_id)
  )
);

CREATE POLICY "Owner manages own bill requests"
ON public.bill_requests
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.outlets
    WHERE outlets.id = bill_requests.outlet_id
      AND outlets.owner_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.outlets
    WHERE outlets.id = bill_requests.outlet_id
      AND outlets.owner_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Public can create payment requests" ON public.payments;
CREATE POLICY "Public can create payment requests"
ON public.payments
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.orders
    WHERE orders.id = payments.order_id
      AND orders.outlet_id = payments.outlet_id
  )
  AND (
    (method = 'cash'::public.payment_method AND status = 'unpaid'::public.payment_status)
    OR
    (method <> 'cash'::public.payment_method AND status = 'pending_verification'::public.payment_status)
  )
);