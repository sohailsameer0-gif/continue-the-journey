CREATE POLICY "Diagnostic hasrole top outlet-images" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'outlet-images' AND name LIKE '%diag-hrtop-%' AND public.has_role(auth.uid(), 'admin')
);