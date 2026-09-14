-- Ensure all existing referral codes are uppercase
UPDATE public.users SET referral_code = UPPER(referral_code);
