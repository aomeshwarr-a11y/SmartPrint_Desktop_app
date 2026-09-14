-- Migration: Ensure storage functions are executable by anon/authenticated
-- This helps resolve cases where RLS policies using storage.foldername() fail

GRANT USAGE ON SCHEMA storage TO anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA storage TO anon, authenticated;

-- Ensure the bucket is correct
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'print-files') THEN
        INSERT INTO storage.buckets (id, name, public) VALUES ('print-files', 'print-files', false);
    ELSE
        UPDATE storage.buckets SET public = false WHERE id = 'print-files';
    END IF;
END $$;
