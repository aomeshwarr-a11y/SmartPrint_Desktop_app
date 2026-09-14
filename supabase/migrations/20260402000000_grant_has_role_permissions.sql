-- Migration: Grant execute permissions on has_role function
-- This fixes the 403 error when frontend calls the RPC

GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO anon, authenticated;

-- Ensure usage is granted on the custom type if not already
GRANT USAGE ON TYPE public.app_role TO anon, authenticated;
