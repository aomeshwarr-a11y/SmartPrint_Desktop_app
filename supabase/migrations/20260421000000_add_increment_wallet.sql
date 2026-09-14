-- Create the atomic increment function for refunds and top-ups
CREATE OR REPLACE FUNCTION public.increment_wallet(p_user_id uuid, p_amount numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.users 
  SET wallet = wallet + p_amount
  WHERE id = p_user_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found: %', p_user_id;
  END IF;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.increment_wallet(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_wallet(uuid, numeric) TO service_role;
