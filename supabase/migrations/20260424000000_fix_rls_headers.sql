-- Fix RLS for print_jobs to be case-insensitive for headers
-- This resolves the issue where mobile browsers sending title-case headers 
-- (like X-Session-Token) would fail the session_token check.
-- Version without has_role to debug the function existence issue.

DROP POLICY IF EXISTS "Select print jobs v2" ON public.print_jobs;
DROP POLICY IF EXISTS "Select print jobs v3" ON public.print_jobs;

CREATE POLICY "Select print jobs v4" 
ON public.print_jobs FOR SELECT 
TO authenticated, anon
USING (
  -- Session-based access (for guests/users who just printed)
  session_token::text = COALESCE(
    (NULLIF(current_setting('request.headers', true), '')::json ->> 'x-session-token'), 
    (NULLIF(current_setting('request.headers', true), '')::json ->> 'X-Session-Token'),
    '00000000-0000-0000-0000-000000000000'
  )
  OR 
  -- Simplified role check using direct table lookup to avoid function errors
  EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
    AND role::text = 'admin'
  )
  OR
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
