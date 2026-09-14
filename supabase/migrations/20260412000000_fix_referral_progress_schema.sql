-- Fix for referral_progress missing column
ALTER TABLE public.referral_progress ADD COLUMN IF NOT EXISTS amount_spent NUMERIC DEFAULT 0;

-- Ensure users can update their own progress (including amount_spent)
DROP POLICY IF EXISTS "Users can update their own referral progress" ON public.referral_progress;
CREATE POLICY "Users can update their own referral progress" 
ON public.referral_progress FOR UPDATE 
USING (auth.uid() = referred_user_id OR auth.uid() = referrer_id);
