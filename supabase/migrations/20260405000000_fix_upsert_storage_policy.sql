-- Migration: Fix storage policy to allow UPSERT (INSERT + UPDATE + SELECT)
-- The previous policy only allowed INSERT, which fails when upsert: true is used.

DROP POLICY IF EXISTS "Allow anyone to upload to print-files" ON storage.objects;

CREATE POLICY "Allow anyone to upload/upsert to print-files"
ON storage.objects
FOR ALL -- This covers INSERT, UPDATE, SELECT, and DELETE
TO anon, authenticated
USING (
  bucket_id = 'print-files'
)
WITH CHECK (
  bucket_id = 'print-files'
);

-- Ensure public access to the bucket if not already set (though we usually want RLS)
-- UPDATE storage.buckets SET public = true WHERE id = 'print-files';
