-- RPC to safely look up user ID by referral code without exposing other data
-- This is SECURITY DEFINER so it can bypass RLS for this specific check
CREATE OR REPLACE FUNCTION public.get_user_id_by_referral_code(code_to_check TEXT)
RETURNS UUID AS $$
DECLARE
  found_id UUID;
BEGIN
  SELECT id INTO found_id 
  FROM public.users 
  WHERE referral_code = UPPER(TRIM(code_to_check));
  
  RETURN found_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant access to both authenticated and anon users
GRANT EXECUTE ON FUNCTION public.get_user_id_by_referral_code(TEXT) TO authenticated, anon;
