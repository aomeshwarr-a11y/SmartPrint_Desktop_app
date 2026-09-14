-- Migration: Validate withdrawal request constraints at database level
CREATE OR REPLACE FUNCTION public.fn_validate_withdrawal()
RETURNS TRIGGER AS $$
DECLARE
  v_wallet NUMERIC;
BEGIN
  -- Get user's current wallet balance
  SELECT wallet INTO v_wallet FROM public.users WHERE id = NEW.user_id;
  
  IF v_wallet IS NULL THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;
  
  IF NEW.amount < 50 THEN
    RAISE EXCEPTION 'Minimum withdrawal amount is ₹50';
  END IF;
  
  IF NEW.amount > v_wallet THEN
    RAISE EXCEPTION 'Insufficient wallet balance';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach the validation trigger to public.withdrawals
DROP TRIGGER IF EXISTS trg_validate_withdrawal ON public.withdrawals;
CREATE TRIGGER trg_validate_withdrawal
  BEFORE INSERT ON public.withdrawals
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_withdrawal();
