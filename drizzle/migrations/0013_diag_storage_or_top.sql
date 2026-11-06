CREATE POLICY "Diagnostic or-top outlet-images" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'outlet-images' AND name LIKE '%diag-ortop-%' AND (
    EXISTS (
      SELECT 1 FROM public.outlets o
      WHERE o.id::text = split_part(name, '/', 1) AND o.owner_id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'admin')
  )
);