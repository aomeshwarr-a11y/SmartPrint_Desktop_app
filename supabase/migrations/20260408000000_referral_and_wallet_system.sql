-- Referral and Wallet System Migration

-- 1. Users table (linked to auth.users)
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone TEXT UNIQUE NOT NULL,
  referral_code TEXT UNIQUE NOT NULL,
  referred_by UUID REFERENCES public.users(id),
  wallet_balance DECIMAL(10, 2) DEFAULT 0 NOT NULL,
  last_active_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- 2. Prints table
CREATE TABLE IF NOT EXISTS public.prints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  pages INTEGER NOT NULL DEFAULT 1,
  amount_paid DECIMAL(10, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- 3. Referral Progress table
CREATE TABLE IF NOT EXISTS public.referral_progress (
  referrer_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  referred_user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  pages_printed INTEGER DEFAULT 0 NOT NULL,
  reward_given BOOLEAN DEFAULT false NOT NULL,
  PRIMARY KEY (referrer_id, referred_user_id)
);

-- 4. Transactions table
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('referral', 'deduction', 'withdrawal')),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- 5. Withdrawals table
CREATE TABLE IF NOT EXISTS public.withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  upi_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own data" ON public.users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can view their own prints" ON public.prints FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can view their referral progress" ON public.referral_progress FOR SELECT USING (auth.uid() = referrer_id OR auth.uid() = referred_user_id);
CREATE POLICY "Users can view their transactions" ON public.transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can view their withdrawals" ON public.withdrawals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert withdrawal requests" ON public.withdrawals FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Function to generate referral code
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  result TEXT := '';
  i INTEGER := 0;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update referral progress and rewards after a print
CREATE OR REPLACE FUNCTION public.handle_print_reward()
RETURNS TRIGGER AS $$
DECLARE
  referrer_id_var UUID;
  current_pages INTEGER;
  reward_already_given BOOLEAN;
BEGIN
  -- Update user's last_active_at
  UPDATE public.users SET last_active_at = now() WHERE id = NEW.user_id;

  -- Check if user was referred
  SELECT referred_by INTO referrer_id_var FROM public.users WHERE id = NEW.user_id;

  IF referrer_id_var IS NOT NULL THEN
    -- Update referral progress
    INSERT INTO public.referral_progress (referrer_id, referred_user_id, pages_printed)
    VALUES (referrer_id_var, NEW.user_id, NEW.pages)
    ON CONFLICT (referrer_id, referred_user_id)
    DO UPDATE SET pages_printed = public.referral_progress.pages_printed + EXCLUDED.pages_printed;

    -- Check if reward should be given
    SELECT pages_printed, reward_given INTO current_pages, reward_already_given
    FROM public.referral_progress
    WHERE referrer_id = referrer_id_var AND referred_user_id = NEW.user_id;

    IF current_pages >= 10 AND NOT reward_already_given THEN
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

CREATE TRIGGER on_print_inserted
  AFTER INSERT ON public.prints
  FOR EACH ROW EXECUTE FUNCTION public.handle_print_reward();

-- Function to handle inactivity deduction (can be called by a cron job)
CREATE OR REPLACE FUNCTION public.deduct_inactivity_fees()
RETURNS void AS $$
BEGIN
  -- Deduct ₹10 from users inactive for > 30 days
  -- This only applies if they have balance > 0
  INSERT INTO public.transactions (user_id, amount, type, status)
  SELECT id, -10, 'deduction', 'completed'
  FROM public.users
  WHERE last_active_at < now() - INTERVAL '30 days'
    AND wallet_balance > 0;

  UPDATE public.users
  SET wallet_balance = GREATEST(0, wallet_balance - 10)
  WHERE last_active_at < now() - INTERVAL '30 days'
    AND wallet_balance > 0;
END;
$$ LANGUAGE plpgsql;
