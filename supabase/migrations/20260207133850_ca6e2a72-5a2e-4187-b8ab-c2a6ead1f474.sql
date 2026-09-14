-- Clean up and rebuild VPrint schema for QR-based flow
-- Drop old tables and recreate with simplified schema

-- First, drop existing RLS policies for printers table
DROP POLICY IF EXISTS "Anyone can view printers" ON public.printers;
DROP POLICY IF EXISTS "Admins can manage printers" ON public.printers;

-- Drop existing RLS policies for print_jobs table  
DROP POLICY IF EXISTS "Allow print job creation" ON public.print_jobs;
DROP POLICY IF EXISTS "View print jobs for admins or via session" ON public.print_jobs;
DROP POLICY IF EXISTS "Update print jobs via session or admin" ON public.print_jobs;
DROP POLICY IF EXISTS "View own print jobs via session or admin" ON public.print_jobs;
DROP POLICY IF EXISTS "Update own print jobs via session or admin" ON public.print_jobs;

-- Drop existing RLS policies for payments table
DROP POLICY IF EXISTS "Allow payment creation" ON public.payments;
DROP POLICY IF EXISTS "View payments for admins or via session" ON public.payments;
DROP POLICY IF EXISTS "Update payments via session or admin" ON public.payments;
DROP POLICY IF EXISTS "View own payments via session or admin" ON public.payments;
DROP POLICY IF EXISTS "Update own payments via session or admin" ON public.payments;

-- Drop existing RLS policies for orders table
DROP POLICY IF EXISTS "Allow order creation" ON public.orders;
DROP POLICY IF EXISTS "View own orders via session or admin" ON public.orders;
DROP POLICY IF EXISTS "Update own orders via session or admin" ON public.orders;
DROP POLICY IF EXISTS "Admins can delete orders" ON public.orders;

-- Drop existing RLS policies for locations table
DROP POLICY IF EXISTS "Anyone can view active locations" ON public.locations;
DROP POLICY IF EXISTS "Admins can manage locations" ON public.locations;

-- Drop foreign key constraints first
ALTER TABLE IF EXISTS public.print_jobs DROP CONSTRAINT IF EXISTS print_jobs_order_id_fkey;
ALTER TABLE IF EXISTS public.print_jobs DROP CONSTRAINT IF EXISTS print_jobs_printer_id_fkey;
ALTER TABLE IF EXISTS public.print_jobs DROP CONSTRAINT IF EXISTS print_jobs_assigned_agent_id_fkey;
ALTER TABLE IF EXISTS public.payments DROP CONSTRAINT IF EXISTS payments_order_id_fkey;
ALTER TABLE IF EXISTS public.orders DROP CONSTRAINT IF EXISTS orders_printer_id_fkey;
ALTER TABLE IF EXISTS public.printer_agents DROP CONSTRAINT IF EXISTS printer_agents_printer_id_fkey;
ALTER TABLE IF EXISTS public.printers DROP CONSTRAINT IF EXISTS printers_location_id_fkey;

-- Drop tables in dependency order
DROP TABLE IF EXISTS public.print_jobs CASCADE;
DROP TABLE IF EXISTS public.payments CASCADE;
DROP TABLE IF EXISTS public.orders CASCADE;
DROP TABLE IF EXISTS public.printer_agents CASCADE;
DROP TABLE IF EXISTS public.printers CASCADE;
DROP TABLE IF EXISTS public.locations CASCADE;

-- =====================================================
-- NEW SIMPLIFIED SCHEMA FOR QR-BASED VPRINT
-- =====================================================

-- 1) PRINTERS TABLE - Self-registering printers via QR scan
CREATE TABLE public.printers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'Self Service Printer',
  location TEXT NOT NULL DEFAULT 'Self Service Kiosk',
  status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'busy')),
  last_seen TIMESTAMP WITH TIME ZONE,
  paper_count INTEGER DEFAULT 500,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on printers
ALTER TABLE public.printers ENABLE ROW LEVEL SECURITY;

-- Anyone can view printers (guest users need to see status)
CREATE POLICY "Anyone can view printers" 
ON public.printers FOR SELECT 
USING (true);

-- Anyone can insert printers (auto-register via QR scan)
CREATE POLICY "Anyone can register printers" 
ON public.printers FOR INSERT 
WITH CHECK (true);

-- Admins can update/delete printers
CREATE POLICY "Admins can manage printers" 
ON public.printers FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role));

-- 2) PRINT_JOBS TABLE - Main job tracking
CREATE TABLE public.print_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  printer_id UUID NOT NULL REFERENCES public.printers(id) ON DELETE CASCADE,
  session_token UUID NOT NULL DEFAULT gen_random_uuid(),
  
  -- File info (array of files)
  files JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  -- Print settings
  total_pages INTEGER NOT NULL DEFAULT 0,
  color_type TEXT NOT NULL DEFAULT 'bw' CHECK (color_type IN ('bw', 'color')),
  copies INTEGER NOT NULL DEFAULT 1,
  paper_size TEXT NOT NULL DEFAULT 'A4',
  
  -- Pricing
  total_price NUMERIC NOT NULL DEFAULT 0,
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'queued', 'printing', 'done', 'failed')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed')),
  
  -- Razorpay info
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  
  -- Error handling
  error_message TEXT,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  paid_at TIMESTAMP WITH TIME ZONE,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS on print_jobs
ALTER TABLE public.print_jobs ENABLE ROW LEVEL SECURITY;

-- Anyone can create print jobs (guest users)
CREATE POLICY "Anyone can create print jobs" 
ON public.print_jobs FOR INSERT 
WITH CHECK (true);

-- View own jobs via session token or admin
CREATE POLICY "View own print jobs" 
ON public.print_jobs FOR SELECT 
USING (
  session_token = COALESCE(
    (((current_setting('request.headers'::text, true))::json ->> 'x-session-token'::text))::uuid, 
    '00000000-0000-0000-0000-000000000000'::uuid
  )
  OR has_role(auth.uid(), 'admin'::app_role)
);

-- Update own jobs via session token or admin
CREATE POLICY "Update own print jobs" 
ON public.print_jobs FOR UPDATE 
USING (
  session_token = COALESCE(
    (((current_setting('request.headers'::text, true))::json ->> 'x-session-token'::text))::uuid, 
    '00000000-0000-0000-0000-000000000000'::uuid
  )
  OR has_role(auth.uid(), 'admin'::app_role)
);

-- Admins can delete jobs
CREATE POLICY "Admins can delete print jobs" 
ON public.print_jobs FOR DELETE 
USING (has_role(auth.uid(), 'admin'::app_role));

-- 3) Create trigger for updated_at on printers
CREATE TRIGGER update_printers_updated_at
BEFORE UPDATE ON public.printers
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- 4) Create indexes for performance
CREATE INDEX idx_print_jobs_printer_id ON public.print_jobs(printer_id);
CREATE INDEX idx_print_jobs_status ON public.print_jobs(status);
CREATE INDEX idx_print_jobs_session_token ON public.print_jobs(session_token);
CREATE INDEX idx_print_jobs_created_at ON public.print_jobs(created_at DESC);
CREATE INDEX idx_printers_status ON public.printers(status);