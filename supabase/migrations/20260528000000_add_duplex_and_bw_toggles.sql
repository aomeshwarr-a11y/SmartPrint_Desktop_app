-- Task 4: DB Migrations Needed
ALTER TABLE public.printers ADD COLUMN IF NOT EXISTS duplex_enabled boolean DEFAULT true;
ALTER TABLE public.printers ADD COLUMN IF NOT EXISTS bw_enabled boolean DEFAULT true;
ALTER TABLE public.print_jobs ADD COLUMN IF NOT EXISTS double_sided boolean DEFAULT false;
