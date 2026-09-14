-- Fix wallet schema and add atomic deduction RPC

-- 1. Rename wallet_balance to wallet on users table if it exists
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'wallet_balance') THEN
    ALTER TABLE public.users RENAME COLUMN wallet_balance TO wallet;
  END IF;
END $$;

-- 2. Create the atomic deduction function
CREATE OR REPLACE FUNCTION public.deduct_wallet(p_user_id uuid, p_amount numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.users 
  SET wallet = wallet - p_amount
  WHERE id = p_user_id AND wallet >= p_amount;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient wallet balance for user %', p_user_id;
  END IF;
END;
$$;

-- 3. Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.deduct_wallet(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_wallet(uuid, numeric) TO service_role;
