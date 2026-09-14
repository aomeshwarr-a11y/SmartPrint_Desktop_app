-- Ensure correct schema for page range and copies
-- Remove any potential triggers or constraints that might interfere with deterministic behavior
DROP TRIGGER IF EXISTS update_print_jobs_updated_at ON public.print_jobs;

-- Ensure columns exist with correct types and defaults
ALTER TABLE public.print_jobs 
  ALTER COLUMN start_page TYPE BIGINT,
  ALTER COLUMN start_page SET NOT NULL,
  ALTER COLUMN start_page SET DEFAULT 1,
  
  ALTER COLUMN end_page TYPE BIGINT,
  ALTER COLUMN end_page SET NOT NULL,
  ALTER COLUMN end_page SET DEFAULT 1,
  
  ALTER COLUMN copies TYPE BIGINT,
  ALTER COLUMN copies SET NOT NULL,
  ALTER COLUMN copies SET DEFAULT 1;

-- Clean up any restrictive constraints that might block valid ranges
ALTER TABLE public.print_jobs DROP CONSTRAINT IF EXISTS print_jobs_status_check;
ALTER TABLE public.print_jobs ADD CONSTRAINT print_jobs_status_check 
CHECK (status IN ('pending', 'paid', 'queued', 'processing', 'printing', 'completed', 'failed'));
