-- Fix RLS Policies and Permissions

-- 1. Allow users to insert their own profile
CREATE POLICY "Users can insert their own profile" 
ON public.users FOR INSERT 
WITH CHECK (auth.uid() = id);

-- 2. Allow users to update their own profile (for last_active_at and referral linking)
CREATE POLICY "Users can update their own profile" 
ON public.users FOR UPDATE 
USING (auth.uid() = id);

-- 3. Grant permissions for the referral code function
-- Explicitly grant to authenticated and anon roles
GRANT EXECUTE ON FUNCTION public.generate_referral_code() TO authenticated, anon;

-- 4. Ensure the function is in the public schema and accessible
ALTER FUNCTION public.generate_referral_code() SECURITY DEFINER;

-- 5. Fix for referral_progress RLS (allow insertion)
CREATE POLICY "Users can insert referral progress" 
ON public.referral_progress FOR INSERT 
WITH CHECK (auth.uid() = referred_user_id);

-- 6. Allow users to update their own referral progress (pages/amount)
CREATE POLICY "Users can update their own referral progress" 
ON public.referral_progress FOR UPDATE 
USING (auth.uid() = referred_user_id);
