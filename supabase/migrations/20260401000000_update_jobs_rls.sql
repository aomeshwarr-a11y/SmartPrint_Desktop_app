-- Migration: Update print_jobs RLS policies for branch owners
-- This ensures branch owners can see jobs for printers assigned to their branches,
-- which is necessary for calculating revenue in the dashboard.

-- 1. Drop existing SELECT policy to replace it
DROP POLICY IF EXISTS "View own print jobs" ON public.print_jobs;
DROP POLICY IF EXISTS "View own print jobs via session or admin" ON public.print_jobs;

-- 2. Create comprehensive SELECT policy
-- Users can see:
-- - Jobs they created (via session token)
-- - All jobs if they are Admin
-- - Jobs for their own branch printers if they are Branch Owners
CREATE POLICY "Select print jobs"
ON public.print_jobs
FOR SELECT
TO authenticated, anon
USING (
  -- Admin access
  public.has_role(auth.uid(), 'admin'::public.app_role) OR
  
  -- Session-based access (for guests/users who just printed)
  session_token = COALESCE(
    (((current_setting('request.headers'::text, true))::json ->> 'x-session-token'::text))::uuid, 
    '00000000-0000-0000-0000-000000000000'::uuid
  ) OR
  
  -- Branch Owner access
  EXISTS (
    SELECT 1 FROM public.printers p
    WHERE p.id = public.print_jobs.printer_id
    AND (
      p.branch_id IN (
        SELECT branch_id FROM public.user_roles 
        WHERE user_id = auth.uid() AND branch_id IS NOT NULL
      )
      OR
      p.branch_id IN (
        SELECT id FROM public.branches
        WHERE owner_id = auth.uid()
      )
    )
  )
);

-- 3. Ensure payments table also has similar access if needed (though dashboard uses print_jobs.total_price)
DROP POLICY IF EXISTS "View own payments via session or admin" ON public.payments;
CREATE POLICY "Select payments"
ON public.payments
FOR SELECT
TO authenticated, anon
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role) OR
  EXISTS (
    SELECT 1 FROM public.print_jobs pj
    JOIN public.printers p ON pj.printer_id = p.id
    WHERE pj.razorpay_order_id = public.payments.razorpay_order_id
    AND (
      p.branch_id IN (SELECT branch_id FROM public.user_roles WHERE user_id = auth.uid())
      OR
      p.branch_id IN (SELECT id FROM public.branches WHERE owner_id = auth.uid())
    )
  )
);
