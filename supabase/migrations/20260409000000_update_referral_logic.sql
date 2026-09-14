-- Update Referral Reward Logic for ₹30 Spent
-- This replaces the previous page-count based trigger

-- 1. Update Referral Progress table to track amount instead of pages
ALTER TABLE public.referral_progress 
ADD COLUMN IF NOT EXISTS amount_spent DECIMAL(10, 2) DEFAULT 0 NOT NULL;

-- 2. Update the trigger function for rewards
CREATE OR REPLACE FUNCTION public.handle_print_reward()
RETURNS TRIGGER AS $$
DECLARE
  referrer_id_var UUID;
  current_spent DECIMAL(10, 2);
  reward_already_given BOOLEAN;
BEGIN
  -- Update user's last_active_at
  UPDATE public.users SET last_active_at = now() WHERE id = NEW.user_id;

  -- Check if user was referred
  SELECT referred_by INTO referrer_id_var FROM public.users WHERE id = NEW.user_id;

  IF referrer_id_var IS NOT NULL THEN
    -- Update referral progress (track both pages and amount, but reward based on amount)
    INSERT INTO public.referral_progress (referrer_id, referred_user_id, pages_printed, amount_spent)
    VALUES (referrer_id_var, NEW.user_id, NEW.pages, NEW.amount_paid)
    ON CONFLICT (referrer_id, referred_user_id)
    DO UPDATE SET 
      pages_printed = public.referral_progress.pages_printed + EXCLUDED.pages_printed,
      amount_spent = public.referral_progress.amount_spent + EXCLUDED.amount_spent;

    -- Check if reward should be given (₹30 spent)
    SELECT amount_spent, reward_given INTO current_spent, reward_already_given
    FROM public.referral_progress
    WHERE referrer_id = referrer_id_var AND referred_user_id = NEW.user_id;

    IF current_spent >= 30 AND NOT reward_already_given THEN
      -- Add ₹10 to referrer wallet
      UPDATE public.users SET wallet_balance = wallet_balance + 10 WHERE id = referrer_id_var;
      
      -- Record transaction
      INSERT INTO public.transactions (user_id, amount, type, status)
      VALUES (referrer_id_var, 10, 'referral', 'completed');

      -- Mark reward as given
      UPDATE public.referral_progress SET reward_given = true
      WHERE referrer_id = referrer_id_var AND referred_user_id = NEW.user_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
