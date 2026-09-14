-- Add pages_to_print column to print_jobs
ALTER TABLE public.print_jobs ADD COLUMN IF NOT EXISTS pages_to_print INTEGER DEFAULT 1;

-- Ensure start_page and end_page exist just in case they were missed
ALTER TABLE public.print_jobs ADD COLUMN IF NOT EXISTS start_page BIGINT;
ALTER TABLE public.print_jobs ADD COLUMN IF NOT EXISTS end_page BIGINT;
