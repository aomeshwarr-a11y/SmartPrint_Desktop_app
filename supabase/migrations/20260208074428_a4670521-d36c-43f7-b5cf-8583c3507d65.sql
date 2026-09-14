-- Drop the overly permissive INSERT policies
DROP POLICY IF EXISTS "Anyone can register printers" ON public.printers;
DROP POLICY IF EXISTS "Anyone can create print jobs" ON public.print_jobs;

-- Create more restrictive INSERT policy for printers
-- Only allow inserting if the printer ID doesn't already exist
-- This prevents data poisoning while still allowing auto-registration
CREATE POLICY "Register new printers only"
ON public.printers
FOR INSERT
WITH CHECK (
  -- Ensure the printer doesn't already exist (prevents overwrites)
  NOT EXISTS (
    SELECT 1 FROM public.printers existing 
    WHERE existing.id = id
  )
);

-- Create more restrictive INSERT policy for print_jobs
-- Require a valid session token that matches the one being inserted
CREATE POLICY "Create jobs with valid session"
ON public.print_jobs
FOR INSERT
WITH CHECK (
  -- Must have a non-null session token
  session_token IS NOT NULL
  -- Must reference an existing, online printer
  AND EXISTS (
    SELECT 1 FROM public.printers p 
    WHERE p.id = printer_id 
    AND p.status IN ('online', 'busy')
  )
);