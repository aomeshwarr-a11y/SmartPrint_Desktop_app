-- Migration: Corrected RLS for printers table
-- Requirements:
-- 1. Admin: full access
-- 2. Authenticated users: Can SELECT (to allow QR scan flow to work for everyone)
-- 3. Branch Owner: Still primarily manages their own branch (managed via UI/queries)
-- 4. INSERT/UPDATE/DELETE: Restricted to Admin

-- 1. Clear old policies
DROP POLICY IF EXISTS "Anyone can view printers" ON public.printers;
DROP POLICY IF EXISTS "Anyone can register printers" ON public.printers;
DROP POLICY IF EXISTS "Register new printers only" ON public.printers;
DROP POLICY IF EXISTS "Admins can manage printers" ON public.printers;
DROP POLICY IF EXISTS "Authenticated users can connect printers" ON public.printers;
DROP POLICY IF EXISTS "Admins and branch owners can view printers" ON public.printers;
DROP POLICY IF EXISTS "Strict select for printers" ON public.printers;
DROP POLICY IF EXISTS "Admins can insert printers" ON public.printers;
DROP POLICY IF EXISTS "Admins can update printers" ON public.printers;
DROP POLICY IF EXISTS "Admins can delete printers" ON public.printers;

-- 2. SELECT (Option 1: Allow all authenticated users)
-- This ensures the QR scan flow (even via RPC) works for any logged-in user.
CREATE POLICY "Allow QR scan access"
ON public.printers
FOR SELECT
TO authenticated
USING (true);

-- 3. INSERT (Admin Only)
CREATE POLICY "Admins can insert printers"
ON public.printers
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- 4. UPDATE (Admin Only)
CREATE POLICY "Admins can update printers"
ON public.printers
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- 5. DELETE (Admin Only)
CREATE POLICY "Admins can delete printers"
ON public.printers
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));
