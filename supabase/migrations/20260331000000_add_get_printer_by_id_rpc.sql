-- Migration: Robust RPC function to fetch printer by ID
-- This function uses SECURITY DEFINER to bypass RLS and is accessible to all visitors (anon + authenticated).
-- This ensures the QR scan flow always works as long as the printer ID is valid.

CREATE OR REPLACE FUNCTION public.get_printer_by_id(p_id UUID)
RETURNS SETOF public.printers
LANGUAGE plpgsql
SECURITY DEFINER -- Essential: Runs as the owner (admin) to bypass RLS
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM public.printers
  WHERE id = p_id;
END;
$$;

-- Ensure permissions are correctly set for both registered and guest users
REVOKE ALL ON FUNCTION public.get_printer_by_id(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_printer_by_id(UUID) TO anon, authenticated;

-- Description for clarity
COMMENT ON FUNCTION public.get_printer_by_id(UUID) IS 'Securely fetches a single printer by ID for any visitor. Bypasses RLS to allow QR scanning while keeping the full table private.';
