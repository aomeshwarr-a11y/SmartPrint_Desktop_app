-- Fix RLS policies to use fail-secure NULL fallback instead of zero UUID
-- This ensures missing session token headers deny access rather than matching a predictable value

-- Drop existing policies that use zero UUID fallback
DROP POLICY IF EXISTS "View own orders via session or admin" ON public.orders;
DROP POLICY IF EXISTS "Update own orders via session or admin" ON public.orders;
DROP POLICY IF EXISTS "View own payments via session or admin" ON public.payments;
DROP POLICY IF EXISTS "Update own payments via session or admin" ON public.payments;
DROP POLICY IF EXISTS "View own print jobs via session or admin" ON public.print_jobs;
DROP POLICY IF EXISTS "Update own print jobs via session or admin" ON public.print_jobs;

-- Recreate policies with NULL fallback (fail-secure approach)
-- Orders SELECT policy
CREATE POLICY "View own orders via session or admin" ON public.orders
FOR SELECT USING (
  has_role(auth.uid(), 'admin'::app_role) OR
  (session_token IS NOT NULL AND 
   session_token = (current_setting('request.headers', true)::json->>'x-session-token')::uuid)
);

-- Orders UPDATE policy
CREATE POLICY "Update own orders via session or admin" ON public.orders
FOR UPDATE USING (
  has_role(auth.uid(), 'admin'::app_role) OR
  (session_token IS NOT NULL AND 
   session_token = (current_setting('request.headers', true)::json->>'x-session-token')::uuid)
) WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) OR
  (session_token IS NOT NULL AND 
   session_token = (current_setting('request.headers', true)::json->>'x-session-token')::uuid)
);

-- Payments SELECT policy
CREATE POLICY "View own payments via session or admin" ON public.payments
FOR SELECT USING (
  has_role(auth.uid(), 'admin'::app_role) OR
  (session_token IS NOT NULL AND 
   session_token = (current_setting('request.headers', true)::json->>'x-session-token')::uuid)
);

-- Payments UPDATE policy
CREATE POLICY "Update own payments via session or admin" ON public.payments
FOR UPDATE USING (
  has_role(auth.uid(), 'admin'::app_role) OR
  (session_token IS NOT NULL AND 
   session_token = (current_setting('request.headers', true)::json->>'x-session-token')::uuid)
) WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) OR
  (session_token IS NOT NULL AND 
   session_token = (current_setting('request.headers', true)::json->>'x-session-token')::uuid)
);

-- Print Jobs SELECT policy
CREATE POLICY "View own print jobs via session or admin" ON public.print_jobs
FOR SELECT USING (
  has_role(auth.uid(), 'admin'::app_role) OR
  (session_token IS NOT NULL AND 
   session_token = (current_setting('request.headers', true)::json->>'x-session-token')::uuid)
);

-- Print Jobs UPDATE policy
CREATE POLICY "Update own print jobs via session or admin" ON public.print_jobs
FOR UPDATE USING (
  has_role(auth.uid(), 'admin'::app_role) OR
  (session_token IS NOT NULL AND 
   session_token = (current_setting('request.headers', true)::json->>'x-session-token')::uuid)
) WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) OR
  (session_token IS NOT NULL AND 
   session_token = (current_setting('request.headers', true)::json->>'x-session-token')::uuid)
);

-- Add file_name length constraint for data integrity
ALTER TABLE public.orders 
ADD CONSTRAINT orders_file_name_length CHECK (length(file_name) <= 255 AND length(file_name) > 0);