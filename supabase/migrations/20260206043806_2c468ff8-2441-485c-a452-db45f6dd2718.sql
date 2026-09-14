-- Fix printer_agents RLS policies to prevent public exposure

-- Drop the overly permissive policies
DROP POLICY IF EXISTS "Anyone can view printer agents" ON public.printer_agents;
DROP POLICY IF EXISTS "Agents can register" ON public.printer_agents;
DROP POLICY IF EXISTS "Agents can update their own record" ON public.printer_agents;

-- Create more restrictive policies:
-- Only admins can view printer agents
CREATE POLICY "Admins can view printer agents"
  ON public.printer_agents FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Note: INSERT and UPDATE for agents is handled through edge functions with PRINTER_AGENT_KEY authentication
-- The edge function uses service role key to bypass RLS