CREATE POLICY "Diagnostic hasrole-not outlet-images" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'outlet-images' AND name LIKE '%diag-hrnot-%' AND NOT public.has_role(auth.uid(), 'admin')
);