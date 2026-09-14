-- Create printer_agents table for laptop/device agents
CREATE TABLE public.printer_agents (
  id text PRIMARY KEY,
  device_name text NOT NULL,
  printer_id uuid REFERENCES public.printers(id) ON DELETE SET NULL,
  last_seen timestamp with time zone DEFAULT now(),
  status text NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'busy'))
);

-- Enable RLS
ALTER TABLE public.printer_agents ENABLE ROW LEVEL SECURITY;

-- Allow anyone to view printer agents (for status display)
CREATE POLICY "Anyone can view printer agents"
ON public.printer_agents
FOR SELECT
USING (true);

-- Agents can update their own record (via service role key in practice)
CREATE POLICY "Agents can update their own record"
ON public.printer_agents
FOR UPDATE
USING (true);

-- Agents can insert their own record
CREATE POLICY "Agents can register"
ON public.printer_agents
FOR INSERT
WITH CHECK (true);

-- Admins can manage all agents
CREATE POLICY "Admins can manage agents"
ON public.printer_agents
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Update print_jobs table to add missing columns for agent workflow
ALTER TABLE public.print_jobs 
ADD COLUMN IF NOT EXISTS file_url text,
ADD COLUMN IF NOT EXISTS copies integer DEFAULT 1,
ADD COLUMN IF NOT EXISTS color_type text DEFAULT 'bw',
ADD COLUMN IF NOT EXISTS paper_size text DEFAULT 'A4',
ADD COLUMN IF NOT EXISTS assigned_agent_id text REFERENCES public.printer_agents(id) ON DELETE SET NULL;

-- Create index for faster pending job queries
CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON public.print_jobs(status);
CREATE INDEX IF NOT EXISTS idx_print_jobs_created_at ON public.print_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_printer_agents_status ON public.printer_agents(status);