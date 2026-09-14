-- Migration: Update printers RLS policies to allow authenticated insertion and restrict selection.
-- This ensures any logged-in user can register a printer while keeping management to authorized roles.

-- 1. Drop existing conflicting policies on the printers table
DROP POLICY IF EXISTS "Anyone can view printers" ON public.printers;
DROP POLICY IF EXISTS "Anyone can register printers" ON public.printers;
DROP POLICY IF EXISTS "Register new printers only" ON public.printers;
DROP POLICY IF EXISTS "Admins can manage printers" ON public.printers;

-- 2. Allow INSERT for all authenticated users
-- This allows any logged-in user to connect/register a printer when scanning a QR code.
CREATE POLICY "Authenticated users can connect printers"
ON public.printers
FOR INSERT
TO authenticated
WITH CHECK (true);

-- 3. Restrict SELECT to admins and branch owners only
-- This ensures only authorized personnel can view the list and status of printers.
CREATE POLICY "Admins and branch owners can view printers"
ON public.printers
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role) OR 
  EXISTS (
    SELECT 1 FROM public.branches b 
    WHERE b.owner_id = auth.uid()
  ) OR
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.branch_id IS NOT NULL
  )
);

-- 4. Restrict UPDATE and DELETE to admins only
CREATE POLICY "Admins can manage printers"
ON public.printers
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
