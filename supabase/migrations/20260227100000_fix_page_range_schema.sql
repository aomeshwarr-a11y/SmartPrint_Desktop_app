-- Ensure page range columns exist and have correct defaults
ALTER TABLE public.print_jobs ADD COLUMN IF NOT EXISTS start_page INTEGER DEFAULT 1;
ALTER TABLE public.print_jobs ADD COLUMN IF NOT EXISTS end_page INTEGER;

-- Update status check constraint to include all lifecycle states
ALTER TABLE public.print_jobs DROP CONSTRAINT IF EXISTS print_jobs_status_check;
ALTER TABLE public.print_jobs ADD CONSTRAINT print_jobs_status_check 
CHECK (status IN ('pending', 'paid', 'queued', 'processing', 'printing', 'completed', 'failed'));
