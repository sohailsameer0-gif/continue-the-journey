-- ============================================================
-- 1. inventory: stock levels are internal; only outlet owners
--    (existing ALL policy) may read them. Public read removed.
-- ============================================================
drop policy if exists "Public can view inventory" on public.inventory;

-- ============================================================
-- 2. bill_requests: anonymous visitors only create requests;
--    reads scoped to the outlet owner and admins.
-- ============================================================
drop policy if exists "Public can view bill requests" on public.bill_requests;
create policy "Outlet owners and admins can view bill requests"
  on public.bill_requests
  for select
  to authenticated
  using (
    exists (
      select 1 from public.outlets o
      where o.id = bill_requests.outlet_id
        and o.owner_id = auth.uid()
    )
    or public.has_role(auth.uid(), 'admin')
  );

-- ============================================================
-- 3. payment_proofs: rows are created server-side (edge function
--    with service role), so the open anon INSERT policy is removed.
--    Reads scoped to the outlet owner of the payment and admins.
-- ============================================================
drop policy if exists "Public can upload proofs" on public.payment_proofs;
drop policy if exists "Payment proofs follow payment access" on public.payment_proofs;
create policy "Outlet owners and admins can view payment proofs"
  on public.payment_proofs
  for select
  to authenticated
  using (
    exists (
      select 1 from public.payments p
      where p.id = payment_proofs.payment_id
        and exists (
          select 1 from public.outlets o
          where o.id = p.outlet_id
            and (o.owner_id = auth.uid() or public.has_role(auth.uid(), 'admin'))
        )
    )
  );

-- ============================================================
-- 4. storage.objects: bind image writes to the owning outlet.
--    Paths are "<outlet_id>/...", so the first folder must be an
--    outlet owned by the caller (admins allowed for support).
--    Public bucket reads stay available through public URLs, so the
--    open public SELECT (listing) policies are removed.
-- ============================================================

-- menu-images
 drop policy if exists "Auth users upload menu images" on storage.objects;
drop policy if exists "Auth users update menu images" on storage.objects;
drop policy if exists "Auth users delete menu images" on storage.objects;
drop policy if exists "Public can view menu images" on storage.objects;

create policy "Outlet owners upload menu images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'menu-images'
    and exists (
      select 1 from public.outlets o
      where o.id::text = (storage.foldername(name))[1]
        and (o.owner_id = auth.uid() or public.has_role(auth.uid(), 'admin'))
    )
  );

create policy "Outlet owners update menu images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'menu-images'
    and exists (
      select 1 from public.outlets o
      where o.id::text = (storage.foldername(name))[1]
        and (o.owner_id = auth.uid() or public.has_role(auth.uid(), 'admin'))
    )
  )
  with check (
    bucket_id = 'menu-images'
    and exists (
      select 1 from public.outlets o
      where o.id::text = (storage.foldername(name))[1]
        and (o.owner_id = auth.uid() or public.has_role(auth.uid(), 'admin'))
    )
  );

create policy "Outlet owners delete menu images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'menu-images'
    and exists (
      select 1 from public.outlets o
      where o.id::text = (storage.foldername(name))[1]
        and (o.owner_id = auth.uid() or public.has_role(auth.uid(), 'admin'))
    )
  );

-- outlet-images
 drop policy if exists "Auth users upload outlet images" on storage.objects;
drop policy if exists "Auth users update outlet images" on storage.objects;
drop policy if exists "Auth users delete outlet images" on storage.objects;
drop policy if exists "Public can view outlet images" on storage.objects;

create policy "Outlet owners upload outlet images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'outlet-images'
    and exists (
      select 1 from public.outlets o
      where o.id::text = (storage.foldername(name))[1]
        and (o.owner_id = auth.uid() or public.has_role(auth.uid(), 'admin'))
    )
  );

create policy "Outlet owners update outlet images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'outlet-images'
    and exists (
      select 1 from public.outlets o
      where o.id::text = (storage.foldername(name))[1]
        and (o.owner_id = auth.uid() or public.has_role(auth.uid(), 'admin'))
    )
  )
  with check (
    bucket_id = 'outlet-images'
    and exists (
      select 1 from public.outlets o
      where o.id::text = (storage.foldername(name))[1]
        and (o.owner_id = auth.uid() or public.has_role(auth.uid(), 'admin'))
    )
  );

create policy "Outlet owners delete outlet images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'outlet-images'
    and exists (
      select 1 from public.outlets o
      where o.id::text = (storage.foldername(name))[1]
        and (o.owner_id = auth.uid() or public.has_role(auth.uid(), 'admin'))
    )
  );

-- payment-proofs (bucket also switched to private via tooling)
 drop policy if exists "Auth users upload payment proofs" on storage.objects;
drop policy if exists "Owner can view payment proofs" on storage.objects;
drop policy if exists "Public can view payment proofs" on storage.objects;

create policy "Outlet owners upload payment proofs"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and exists (
      select 1 from public.outlets o
      where o.id::text = (storage.foldername(name))[1]
        and (o.owner_id = auth.uid() or public.has_role(auth.uid(), 'admin'))
    )
  );

create policy "Outlet owners and admins view payment proofs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and exists (
      select 1 from public.outlets o
      where o.id::text = (storage.foldername(name))[1]
        and (o.owner_id = auth.uid() or public.has_role(auth.uid(), 'admin'))
    )
  );

-- admin-payment-qr: QR images remain publicly viewable by URL;
-- the open public listing policy is removed.
drop policy if exists "Public read admin-payment-qr" on storage.objects;
