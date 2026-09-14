-- Ensure has_withdrawn column exists and has correct defaults
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS has_withdrawn BOOLEAN DEFAULT false;

-- Update any existing NULL values to false
UPDATE public.users SET has_withdrawn = false WHERE has_withdrawn IS NULL;

-- Make it NOT NULL now that data is cleaned
ALTER TABLE public.users ALTER COLUMN has_withdrawn SET NOT NULL;
ALTER TABLE public.users ALTER COLUMN has_withdrawn SET DEFAULT false;
