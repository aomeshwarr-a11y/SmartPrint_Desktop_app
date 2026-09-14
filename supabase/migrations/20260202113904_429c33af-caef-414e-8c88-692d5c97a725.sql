-- Add session_token to orders for anonymous kiosk access control
ALTER TABLE public.orders 
ADD COLUMN session_token uuid DEFAULT gen_random_uuid();

-- Create index for session token lookups
CREATE INDEX idx_orders_session_token ON public.orders(session_token);

-- Drop overly permissive RLS policies on orders
DROP POLICY IF EXISTS "Anyone can view orders" ON public.orders;
DROP POLICY IF EXISTS "Anyone can update orders" ON public.orders;
DROP POLICY IF EXISTS "Anyone can create orders" ON public.orders;

-- Create restrictive policies for orders using session tokens
-- Only allow creating orders (session token is auto-generated)
CREATE POLICY "Allow order creation"
ON public.orders
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- Only allow viewing orders with matching session token (passed via RPC) or admin
CREATE POLICY "View own orders via session or admin"
ON public.orders
FOR SELECT
TO anon, authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role) OR
  session_token = COALESCE(
    (current_setting('request.headers', true)::json->>'x-session-token')::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid
  )
);

-- Only allow updating own orders via session token or admin
CREATE POLICY "Update own orders via session or admin"
ON public.orders
FOR UPDATE
TO anon, authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role) OR
  session_token = COALESCE(
    (current_setting('request.headers', true)::json->>'x-session-token')::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid
  )
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) OR
  session_token = COALESCE(
    (current_setting('request.headers', true)::json->>'x-session-token')::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid
  )
);

-- Drop overly permissive RLS policies on payments
DROP POLICY IF EXISTS "Anyone can view payments" ON public.payments;
DROP POLICY IF EXISTS "Anyone can update payments" ON public.payments;
DROP POLICY IF EXISTS "Anyone can create payments" ON public.payments;

-- Add session_token to payments for access control
ALTER TABLE public.payments 
ADD COLUMN session_token uuid;

-- Create restrictive policies for payments
CREATE POLICY "Allow payment creation"
ON public.payments
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- Only admin can view all payments, or via matching session token
CREATE POLICY "View payments for admins or via session"
ON public.payments
FOR SELECT
TO anon, authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role) OR
  session_token = COALESCE(
    (current_setting('request.headers', true)::json->>'x-session-token')::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid
  )
);

-- Only allow updating own payments via session token or admin
CREATE POLICY "Update payments via session or admin"
ON public.payments
FOR UPDATE
TO anon, authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role) OR
  session_token = COALESCE(
    (current_setting('request.headers', true)::json->>'x-session-token')::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid
  )
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) OR
  session_token = COALESCE(
    (current_setting('request.headers', true)::json->>'x-session-token')::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid
  )
);

-- Drop overly permissive policies on print_jobs
DROP POLICY IF EXISTS "Anyone can view print jobs" ON public.print_jobs;
DROP POLICY IF EXISTS "Anyone can update print jobs" ON public.print_jobs;
DROP POLICY IF EXISTS "Anyone can create print jobs" ON public.print_jobs;

-- Add session_token to print_jobs
ALTER TABLE public.print_jobs
ADD COLUMN session_token uuid;

-- Create restrictive policies for print_jobs
CREATE POLICY "Allow print job creation"
ON public.print_jobs
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "View print jobs for admins or via session"
ON public.print_jobs
FOR SELECT
TO anon, authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role) OR
  session_token = COALESCE(
    (current_setting('request.headers', true)::json->>'x-session-token')::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid
  )
);

CREATE POLICY "Update print jobs via session or admin"
ON public.print_jobs
FOR UPDATE
TO anon, authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role) OR
  session_token = COALESCE(
    (current_setting('request.headers', true)::json->>'x-session-token')::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid
  )
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) OR
  session_token = COALESCE(
    (current_setting('request.headers', true)::json->>'x-session-token')::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid
  )
);

-- Update storage bucket to be private
UPDATE storage.buckets 
SET public = false 
WHERE id = 'print-files';

-- Drop permissive storage policies
DROP POLICY IF EXISTS "Anyone can upload print files" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view print files" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete their print files" ON storage.objects;

-- Create restrictive storage policies - using folder-based session tokens
-- Files are uploaded to: {session_token}/filename
CREATE POLICY "Upload files to session folder"
ON storage.objects
FOR INSERT
TO anon, authenticated
WITH CHECK (
  bucket_id = 'print-files' AND
  (storage.foldername(name))[1] IS NOT NULL
);

-- Only allow viewing files in own session folder or admin
CREATE POLICY "View files in session folder or admin"
ON storage.objects
FOR SELECT
TO anon, authenticated
USING (
  bucket_id = 'print-files' AND
  (
    has_role(auth.uid(), 'admin'::app_role) OR
    (storage.foldername(name))[1] = COALESCE(
      current_setting('request.headers', true)::json->>'x-session-token',
      ''
    )
  )
);

-- Allow deletion of files in own session folder
CREATE POLICY "Delete files in session folder or admin"
ON storage.objects
FOR DELETE
TO anon, authenticated
USING (
  bucket_id = 'print-files' AND
  (
    has_role(auth.uid(), 'admin'::app_role) OR
    (storage.foldername(name))[1] = COALESCE(
      current_setting('request.headers', true)::json->>'x-session-token',
      ''
    )
  )
);