-- Enable realtime for payments and payment_proofs so outlet dashboards
-- get instant notifications when a customer submits a cash or online payment.
ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_proofs;