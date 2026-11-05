CREATE POLICY "Diagnostic test insert outlet-images" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'outlet-images' AND name LIKE '%diagnostic-test-%'
);