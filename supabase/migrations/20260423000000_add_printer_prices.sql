-- Migration: Add pricing columns to printers table
ALTER TABLE public.printers ADD COLUMN IF NOT EXISTS price_per_page NUMERIC DEFAULT 2;
ALTER TABLE public.printers ADD COLUMN IF NOT EXISTS price_color NUMERIC DEFAULT 10;

-- Sync existing printers with branch prices if they exist
UPDATE public.printers p
SET 
  price_per_page = COALESCE(b.price_per_page, 2),
  price_color = COALESCE(b.price_color, 10)
FROM public.branches b
WHERE p.branch_id = b.id;
