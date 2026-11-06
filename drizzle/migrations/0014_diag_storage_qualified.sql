CREATE POLICY "Diagnostic qualified name outlet-images" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'outlet-images' AND name LIKE '%diag-qual-%' AND EXISTS (
    SELECT 1 FROM public.outlets o
    WHERE o.id::text = split_part(storage.objects.name, '/', 1)
      AND o.owner_id = auth.uid()
  )
);