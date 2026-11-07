CREATE OR REPLACE FUNCTION public.can_manage_outlet_file(_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.outlets o
    WHERE o.id::text = split_part(_path, '/', 1)
      AND (o.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  );
$$;
GRANT EXECUTE ON FUNCTION public.can_manage_outlet_file(text) TO authenticated;

DROP POLICY IF EXISTS "Diagnostic hasrole outlet-images" ON storage.objects;
DROP POLICY IF EXISTS "Diagnostic hasrole top outlet-images" ON storage.objects;
DROP POLICY IF EXISTS "Diagnostic hasrole-not outlet-images" ON storage.objects;
DROP POLICY IF EXISTS "Diagnostic or-top outlet-images" ON storage.objects;
DROP POLICY IF EXISTS "Diagnostic qualified name outlet-images" ON storage.objects;

DROP POLICY IF EXISTS "Outlet owners upload menu images" ON storage.objects;
CREATE POLICY "Outlet owners upload menu images" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'menu-images' AND public.can_manage_outlet_file(name));
DROP POLICY IF EXISTS "Outlet owners update menu images" ON storage.objects;
CREATE POLICY "Outlet owners update menu images" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'menu-images' AND public.can_manage_outlet_file(name))
WITH CHECK (bucket_id = 'menu-images' AND public.can_manage_outlet_file(name));
DROP POLICY IF EXISTS "Outlet owners delete menu images" ON storage.objects;
CREATE POLICY "Outlet owners delete menu images" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'menu-images' AND public.can_manage_outlet_file(name));

DROP POLICY IF EXISTS "Outlet owners upload outlet images" ON storage.objects;
CREATE POLICY "Outlet owners upload outlet images" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'outlet-images' AND public.can_manage_outlet_file(name));
DROP POLICY IF EXISTS "Outlet owners update outlet images" ON storage.objects;
CREATE POLICY "Outlet owners update outlet images" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'outlet-images' AND public.can_manage_outlet_file(name))
WITH CHECK (bucket_id = 'outlet-images' AND public.can_manage_outlet_file(name));
DROP POLICY IF EXISTS "Outlet owners delete outlet images" ON storage.objects;
CREATE POLICY "Outlet owners delete outlet images" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'outlet-images' AND public.can_manage_outlet_file(name));

DROP POLICY IF EXISTS "Outlet owners upload payment proofs" ON storage.objects;
CREATE POLICY "Outlet owners upload payment proofs" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'payment-proofs' AND public.can_manage_outlet_file(name));
DROP POLICY IF EXISTS "Outlet owners and admins view payment proofs" ON storage.objects;
CREATE POLICY "Outlet owners and admins view payment proofs" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'payment-proofs' AND public.can_manage_outlet_file(name));