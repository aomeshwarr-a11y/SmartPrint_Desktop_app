-- Migration: Fix Printer Status Flow, RLS, and add missing RPC
-- Description: 
-- 1. Fixes RLS for print_jobs to handle empty headers gracefully.
-- 2. Fixes RLS for printers to allow guest (anon) access for QR scanning.
-- 3. Adds the missing complete_print_job RPC used by the printer agent.

-- 1. Fix RLS for print_jobs SELECT policy
DROP POLICY IF EXISTS "View own print jobs" ON public.print_jobs;
DROP POLICY IF EXISTS "Select print jobs" ON public.print_jobs;

CREATE POLICY "Select print jobs v2" 
ON public.print_jobs FOR SELECT 
TO authenticated, anon
USING (
  -- Session-based access (for guests/users who just printed)
  -- Use NULLIF to handle empty strings and avoid JSON parsing errors
  session_token = COALESCE(
    (NULLIF(current_setting('request.headers', true), '')::json ->> 'x-session-token')::uuid, 
    '00000000-0000-0000-0000-000000000000'::uuid
  )
  OR 
  -- Admin access
  public.has_role(auth.uid(), 'admin'::public.app_role)
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

-- 2. Fix RLS for printers to allow guests (anon)
DROP POLICY IF EXISTS "Allow QR scan access" ON public.printers;
DROP POLICY IF EXISTS "Allow guest QR scan access" ON public.printers;

CREATE POLICY "Allow guest QR scan access"
ON public.printers FOR SELECT
TO authenticated, anon
USING (true);

-- 3. Add missing complete_print_job RPC
CREATE OR REPLACE FUNCTION public.complete_print_job(
  p_job_id uuid,
  p_user_id uuid DEFAULT NULL,
  p_pages integer DEFAULT 1,
  p_amount numeric DEFAULT 0,
  p_printer_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_file_name text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- 1. Mark job as done
  UPDATE public.print_jobs
  SET status = 'done',
      completed_at = now()
  WHERE id = p_job_id;

  -- 2. Log in prints table (if user_id provided)
  IF p_user_id IS NOT NULL THEN
    -- Check if user exists before inserting
    IF EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN
      INSERT INTO public.prints (user_id, pages, amount_paid)
      VALUES (p_user_id, p_pages, p_amount);
    END IF;
  END IF;
END;
$$;

-- Grant permissions for RPC
GRANT EXECUTE ON FUNCTION public.complete_print_job(uuid, uuid, integer, numeric, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_print_job(uuid, uuid, integer, numeric, uuid, uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.complete_print_job(uuid, uuid, integer, numeric, uuid, uuid, text) TO service_role;
