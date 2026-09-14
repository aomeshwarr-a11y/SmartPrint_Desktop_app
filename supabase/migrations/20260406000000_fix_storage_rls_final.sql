-- Migration: Final fix for storage RLS issues
-- Drops all existing policies and creates a single, bulletproof policy for the print-files bucket

-- 1. Ensure bucket exists and is set up correctly
INSERT INTO storage.buckets (id, name, public)
VALUES ('print-files', 'print-files', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- 2. Clean up ALL previous policies on storage.objects to avoid conflicts
DO $$
BEGIN
    FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage') LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || r.policyname || '" ON storage.objects';
    END LOOP;
END $$;

-- 3. Create a single, robust policy for ALL operations
-- We use FOR ALL to cover INSERT, UPDATE, SELECT, and DELETE
CREATE POLICY "Final storage policy for print-files"
ON storage.objects
FOR ALL
TO anon, authenticated
USING (bucket_id = 'print-files')
WITH CHECK (bucket_id = 'print-files');

-- 4. Re-grant necessary permissions to anon and authenticated
GRANT USAGE ON SCHEMA storage TO anon, authenticated;
GRANT ALL ON TABLE storage.objects TO anon, authenticated;
GRANT ALL ON TABLE storage.buckets TO anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA storage TO anon, authenticated;
