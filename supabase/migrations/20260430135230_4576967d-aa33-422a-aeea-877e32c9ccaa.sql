-- File: enums + plan_requests + activity_logs (outlet_access already exists, IF NOT EXISTS skips)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'paid_active' AND enumtypid = 'public.subscription_status'::regtype) THEN
    ALTER TYPE public.subscription_status ADD VALUE 'paid_active';
  END IF;
END $$;

ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS paid_until timestamptz;

CREATE TABLE IF NOT EXISTS public.plan_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL REFERENCES public.outlets(id) ON DELETE CASCADE,
  requested_plan text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  method text NOT NULL,
  transaction_id text,
  proof_url text,
  status text NOT NULL DEFAULT 'pending',
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.plan_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner manages plan requests" ON public.plan_requests;
CREATE POLICY "Owner manages plan requests" ON public.plan_requests
  FOR ALL USING (EXISTS (SELECT 1 FROM public.outlets WHERE outlets.id = plan_requests.outlet_id AND outlets.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.outlets WHERE outlets.id = plan_requests.outlet_id AND outlets.owner_id = auth.uid()));

DROP POLICY IF EXISTS "Admins manage plan requests" ON public.plan_requests;
CREATE POLICY "Admins manage plan requests" ON public.plan_requests
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS update_plan_requests_updated_at ON public.plan_requests;
CREATE TRIGGER update_plan_requests_updated_at
  BEFORE UPDATE ON public.plan_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- activity_logs already exists from batch 1 -- skip if so
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  actor_email text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  entity_label text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read activity logs" ON public.activity_logs;
CREATE POLICY "Admins read activity logs" ON public.activity_logs
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated users can insert activity logs" ON public.activity_logs;
CREATE POLICY "Authenticated users can insert activity logs" ON public.activity_logs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = actor_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'pending_verification' AND enumtypid = 'public.payment_status'::regtype) THEN
    ALTER TYPE public.payment_status ADD VALUE 'pending_verification';
  END IF;
END $$;

-- File: outlet_access schema repair (idempotent ADD COLUMNs)
ALTER TABLE public.outlet_access
  ADD COLUMN IF NOT EXISTS otp_code_hash text,
  ADD COLUMN IF NOT EXISTS otp_plain_for_admin text,
  ADD COLUMN IF NOT EXISTS otp_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS otp_max_attempts integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS rejected_reason text,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_password_changed_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outlet_access_outlet_id_key') THEN
    ALTER TABLE public.outlet_access ADD CONSTRAINT outlet_access_outlet_id_key UNIQUE (outlet_id);
  END IF;
END $$;