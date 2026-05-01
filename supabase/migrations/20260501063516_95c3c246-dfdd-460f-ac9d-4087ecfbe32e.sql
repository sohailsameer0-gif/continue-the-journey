UPDATE storage.buckets SET public = true WHERE id = 'payment-proofs';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Public can view payment proofs'
  ) THEN
    CREATE POLICY "Public can view payment proofs"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'payment-proofs');
  END IF;
END$$;