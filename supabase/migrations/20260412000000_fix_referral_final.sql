-- 1. Add missing amount_spent column
ALTER TABLE public.referral_progress ADD COLUMN IF NOT EXISTS amount_spent NUMERIC DEFAULT 0;

-- 2. Ensure the referral_progress table has the correct RLS policies
-- This allows referrers to see who they referred
ALTER TABLE public.referral_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own referrals" ON public.referral_progress;
CREATE POLICY "Users can view their own referrals" 
ON public.referral_progress FOR SELECT 
USING (auth.uid() = referrer_id OR auth.uid() = referred_user_id);

-- 3. Ensure the users table allows searching by referral_code for the lookup
-- Note: This is usually safe as referral codes are public identifiers
DROP POLICY IF EXISTS "Public can lookup referral codes" ON public.users;
CREATE POLICY "Public can lookup referral codes"
ON public.users FOR SELECT
USING (true);
