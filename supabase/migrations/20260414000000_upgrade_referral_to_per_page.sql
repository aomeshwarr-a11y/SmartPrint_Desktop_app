-- Update referral_progress table for per-page earnings
ALTER TABLE public.referral_progress 
ADD COLUMN IF NOT EXISTS total_earnings DECIMAL(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_pages INTEGER DEFAULT 0;

-- Drop old trigger/function and create the new per-page reward logic
DROP TRIGGER IF EXISTS on_print_inserted ON public.prints;
DROP FUNCTION IF EXISTS public.handle_print_reward();

CREATE OR REPLACE FUNCTION public.handle_print_reward()
RETURNS TRIGGER AS $$
DECLARE
  referrer_id_var UUID;
  reward_amount DECIMAL(10, 2);
BEGIN
  -- Update user's last_active_at
  UPDATE public.users SET last_active_at = now() WHERE id = NEW.user_id;

  -- Check if user was referred
  SELECT referred_by INTO referrer_id_var FROM public.users WHERE id = NEW.user_id;

  IF referrer_id_var IS NOT NULL THEN
    -- Calculate reward (₹0.5 per page)
    reward_amount := NEW.pages * 0.5;

    -- 1. Update/Insert referral progress
    INSERT INTO public.referral_progress (
      referrer_id, 
      referred_user_id, 
      pages_printed, 
      total_pages, 
      total_earnings,
      amount_spent
    )
    VALUES (
      referrer_id_var, 
      NEW.user_id, 
      NEW.pages, 
      NEW.pages, 
      reward_amount,
      0 -- amount_spent handled elsewhere or can be updated here
    )
    ON CONFLICT (referrer_id, referred_user_id)
    DO UPDATE SET 
      pages_printed = public.referral_progress.pages_printed + EXCLUDED.pages_printed,
      total_pages = public.referral_progress.total_pages + EXCLUDED.total_pages,
      total_earnings = public.referral_progress.total_earnings + EXCLUDED.total_earnings;

    -- 2. Add reward to referrer wallet_balance
    UPDATE public.users 
    SET wallet_balance = wallet_balance + reward_amount 
    WHERE id = referrer_id_var;
    
    -- 3. Record transaction for the referrer
    INSERT INTO public.transactions (user_id, amount, type, status)
    VALUES (referrer_id_var, reward_amount, 'referral', 'completed');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-attach the trigger
CREATE TRIGGER on_print_inserted
  AFTER INSERT ON public.prints
  FOR EACH ROW EXECUTE FUNCTION public.handle_print_reward();
