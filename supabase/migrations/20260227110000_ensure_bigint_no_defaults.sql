-- Fix page range column types and remove schema-level defaults
ALTER TABLE public.print_jobs ALTER COLUMN start_page TYPE bigint;
ALTER TABLE public.print_jobs ALTER COLUMN end_page TYPE bigint;

ALTER TABLE public.print_jobs ALTER COLUMN start_page DROP DEFAULT;
ALTER TABLE public.print_jobs ALTER COLUMN end_page DROP DEFAULT;
