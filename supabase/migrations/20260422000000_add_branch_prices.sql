-- Migration: Add pricing columns to branches table
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS price_per_page NUMERIC DEFAULT 2;
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS price_color NUMERIC DEFAULT 10;

-- Ensure branch owner can update their own branch prices
-- Existing policy might already cover this, but let's be sure
DROP POLICY IF EXISTS "Branch owners can update their own branch" ON public.branches;
CREATE POLICY "Branch owners can update their own branch"
ON public.branches
FOR UPDATE
TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

-- Also allow select for authenticated users (to fetch prices for jobs)
DROP POLICY IF EXISTS "Anyone can view branches" ON public.branches;
CREATE POLICY "Anyone can view branches"
ON public.branches
FOR SELECT
USING (true);
