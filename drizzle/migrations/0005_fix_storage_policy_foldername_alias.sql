-- The owner-scoped storage policies referenced `o.name` inside the EXISTS subquery,
-- which resolves to the outlet's own `name` column instead of the storage object's
-- file path, so every owner upload was rejected. Qualify the object column explicitly.

DROP POLICY IF EXISTS "Outlet owners upload menu images" ON storage.objects;
CREATE POLICY "Outlet owners upload menu images" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'menu-images' AND EXISTS (
    SELECT 1 FROM public.outlets o
    WHERE o.id::text = (storage.foldername(storage.objects.name))[1]
      AND (o.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  )
);

DROP POLICY IF EXISTS "Outlet owners update menu images" ON storage.objects;
CREATE POLICY "Outlet owners update menu images" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'menu-images' AND EXISTS (
    SELECT 1 FROM public.outlets o
    WHERE o.id::text = (storage.foldername(storage.objects.name))[1]
      AND (o.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  )
)
WITH CHECK (
  bucket_id = 'menu-images' AND EXISTS (
    SELECT 1 FROM public.outlets o
    WHERE o.id::text = (storage.foldername(storage.objects.name))[1]
      AND (o.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  )
);

DROP POLICY IF EXISTS "Outlet owners delete menu images" ON storage.objects;
CREATE POLICY "Outlet owners delete menu images" ON storage.objects
FOR DELETE TO authenticated USING (
  bucket_id = 'menu-images' AND EXISTS (
    SELECT 1 FROM public.outlets o
    WHERE o.id::text = (storage.foldername(storage.objects.name))[1]
      AND (o.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  )
);

DROP POLICY IF EXISTS "Outlet owners upload outlet images" ON storage.objects;
CREATE POLICY "Outlet owners upload outlet images" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'outlet-images' AND EXISTS (
    SELECT 1 FROM public.outlets o
    WHERE o.id::text = (storage.foldername(storage.objects.name))[1]
      AND (o.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  )
);

DROP POLICY IF EXISTS "Outlet owners update outlet images" ON storage.objects;
CREATE POLICY "Outlet owners update outlet images" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'outlet-images' AND EXISTS (
    SELECT 1 FROM public.outlets o
    WHERE o.id::text = (storage.foldername(storage.objects.name))[1]
      AND (o.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  )
)
WITH CHECK (
  bucket_id = 'outlet-images' AND EXISTS (
    SELECT 1 FROM public.outlets o
    WHERE o.id::text = (storage.foldername(storage.objects.name))[1]
      AND (o.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  )
);

DROP POLICY IF EXISTS "Outlet owners delete outlet images" ON storage.objects;
CREATE POLICY "Outlet owners delete outlet images" ON storage.objects
FOR DELETE TO authenticated USING (
  bucket_id = 'outlet-images' AND EXISTS (
    SELECT 1 FROM public.outlets o
    WHERE o.id::text = (storage.foldername(storage.objects.name))[1]
      AND (o.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  )
);

DROP POLICY IF EXISTS "Outlet owners upload payment proofs" ON storage.objects;
CREATE POLICY "Outlet owners upload payment proofs" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'payment-proofs' AND EXISTS (
    SELECT 1 FROM public.outlets o
    WHERE o.id::text = (storage.foldername(storage.objects.name))[1]
      AND (o.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  )
);

DROP POLICY IF EXISTS "Outlet owners and admins view payment proofs" ON storage.objects;
CREATE POLICY "Outlet owners and admins view payment proofs" ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id = 'payment-proofs' AND EXISTS (
    SELECT 1 FROM public.outlets o
    WHERE o.id::text = (storage.foldername(storage.objects.name))[1]
      AND (o.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  )
);