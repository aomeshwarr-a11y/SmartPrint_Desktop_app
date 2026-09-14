-- Migration: Simplify storage upload policy
-- This policy is less restrictive to help debug RLS issues

DROP POLICY IF EXISTS "Upload files to session folder" ON storage.objects;

CREATE POLICY "Allow anyone to upload to print-files"
ON storage.objects
FOR INSERT
TO anon, authenticated
WITH CHECK (
  bucket_id = 'print-files'
);

-- Ensure anon has access to storage schema
GRANT USAGE ON SCHEMA storage TO anon, authenticated;
GRANT ALL ON TABLE storage.objects TO anon, authenticated;
GRANT ALL ON TABLE storage.buckets TO anon, authenticated;
