-- Add page range columns to print_jobs
ALTER TABLE public.print_jobs ADD COLUMN IF NOT EXISTS start_page INTEGER;
ALTER TABLE public.print_jobs ADD COLUMN IF NOT EXISTS end_page INTEGER;

-- Update status check constraint to include 'completed' and 'processing' if they aren't there
-- Actually, 'printing' is already there, let's keep it but maybe add 'completed' as an alias or replace 'done'
ALTER TABLE public.print_jobs DROP CONSTRAINT IF EXISTS print_jobs_status_check;
ALTER TABLE public.print_jobs ADD CONSTRAINT print_jobs_status_check 
CHECK (status IN ('pending', 'paid', 'queued', 'processing', 'printing', 'completed', 'done', 'failed'));
