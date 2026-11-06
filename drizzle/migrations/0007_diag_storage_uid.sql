CREATE POLICY "Diagnostic auth uid outlet-images" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'outlet-images' AND name LIKE '%diagnostic-uid-%' AND auth.uid() IS NOT NULL
);