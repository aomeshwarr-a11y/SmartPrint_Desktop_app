-- Task Extension: Enhanced Pricing Model
ALTER TABLE public.printers ADD COLUMN IF NOT EXISTS price_bw_duplex     numeric DEFAULT 1.50;
ALTER TABLE public.printers ADD COLUMN IF NOT EXISTS price_color_duplex  numeric DEFAULT 4.00;
-- duplex_enabled and bw_enabled were added in the previous migration, but ensuring they exist
ALTER TABLE public.printers ADD COLUMN IF NOT EXISTS duplex_enabled       boolean DEFAULT true;
ALTER TABLE public.printers ADD COLUMN IF NOT EXISTS bw_enabled           boolean DEFAULT true;

ALTER TABLE public.print_jobs ADD COLUMN IF NOT EXISTS price_per_page_used numeric DEFAULT 2.00;
