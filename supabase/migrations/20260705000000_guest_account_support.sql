-- Migration: Guest Account Support
-- Adds is_guest flag to users table and updates RLS/functions to support
-- seamless guest → registered account upgrade flow.
-- No existing tables are duplicated. Guests share the same users, wallet,
-- transactions, print_jobs, and orders tables as registered users.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extend users table with guest fields
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS guest_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS full_name TEXT;

-- Make phone nullable so guests don't need one
ALTER TABLE public.users
  ALTER COLUMN phone DROP NOT NULL;

-- Make referral_code nullable for guests (they don't participate in referrals)
ALTER TABLE public.users
  ALTER COLUMN referral_code DROP NOT NULL;

-- Index for fast guest lookups
CREATE INDEX IF NOT EXISTS idx_users_is_guest ON public.users(is_guest);
CREATE INDEX IF NOT EXISTS idx_users_guest_id ON public.users(guest_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RLS: Guests can read/update their own row just like registered users
-- ─────────────────────────────────────────────────────────────────────────────
-- The existing policy "Users can view their own data" uses auth.uid() = id,
-- which works identically for guests (they get a real Supabase auth session).
-- No additional policies needed.

-- Allow service_role to create guest user rows (called from edge function)
CREATE POLICY IF NOT EXISTS "Service role can insert users"
  ON public.users FOR INSERT
  WITH CHECK (TRUE);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Function: Create a guest user session
-- Creates a full users row with is_guest = true and an empty wallet.
-- Called after Supabase anonymous sign-in creates the auth.users row.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_guest_user(
  p_auth_id   UUID,
  p_guest_id  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user RECORD;
BEGIN
  -- Idempotent: if a row already exists for this auth id, just return it
  SELECT * INTO v_user FROM public.users WHERE id = p_auth_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'id',       v_user.id,
      'guest_id', v_user.guest_id,
      'wallet',   v_user.wallet,
      'is_guest', v_user.is_guest
    );
  END IF;

  INSERT INTO public.users (
    id,
    is_guest,
    guest_id,
    phone,
    referral_code,
    wallet,
    last_active_at,
    created_at
  ) VALUES (
    p_auth_id,
    TRUE,
    p_guest_id,
    NULL,   -- no phone for guest
    NULL,   -- no referral code for guest
    0,
    now(),
    now()
  )
  RETURNING * INTO v_user;

  RETURN jsonb_build_object(
    'id',       v_user.id,
    'guest_id', v_user.guest_id,
    'wallet',   v_user.wallet,
    'is_guest', v_user.is_guest
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_guest_user(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_guest_user(UUID, TEXT) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Function: Upgrade guest to registered user
-- Changes is_guest → false, sets phone + password-hash marker.
-- All existing wallet balance, transactions, orders, and print history are
-- preserved because they share the same user id.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upgrade_guest_to_registered(
  p_auth_id      UUID,
  p_phone        TEXT,
  p_referral_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user           RECORD;
  v_final_referral TEXT;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE id = p_auth_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found: %', p_auth_id;
  END IF;

  IF NOT v_user.is_guest THEN
    RAISE EXCEPTION 'User is already a registered account';
  END IF;

  -- Check phone uniqueness
  IF EXISTS (SELECT 1 FROM public.users WHERE phone = p_phone AND id <> p_auth_id) THEN
    RAISE EXCEPTION 'Phone number already registered';
  END IF;

  -- Generate referral code if not provided
  v_final_referral := COALESCE(p_referral_code, public.generate_referral_code());
  -- Ensure uniqueness
  WHILE EXISTS (SELECT 1 FROM public.users WHERE referral_code = v_final_referral AND id <> p_auth_id) LOOP
    v_final_referral := public.generate_referral_code();
  END LOOP;

  UPDATE public.users
  SET
    is_guest      = FALSE,
    phone         = p_phone,
    referral_code = v_final_referral,
    guest_id      = NULL,  -- clear guest marker after upgrade
    last_active_at = now()
  WHERE id = p_auth_id
  RETURNING * INTO v_user;

  RETURN jsonb_build_object(
    'id',            v_user.id,
    'phone',         v_user.phone,
    'referral_code', v_user.referral_code,
    'wallet',        v_user.wallet,
    'is_guest',      v_user.is_guest
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.upgrade_guest_to_registered(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upgrade_guest_to_registered(UUID, TEXT, TEXT) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Update get_my_profile RPC to expose is_guest flag
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user  RECORD;
  v_roles JSONB;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE id = auth.uid();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('roles', '[]'::jsonb, 'user', NULL, 'wallet', 0);
  END IF;

  -- Collect roles from user_roles if the table exists
  BEGIN
    SELECT jsonb_agg(jsonb_build_object('role', role, 'branch_id', branch_id))
    INTO v_roles
    FROM public.user_roles
    WHERE user_id = auth.uid();
  EXCEPTION WHEN undefined_table THEN
    v_roles := '[]'::jsonb;
  END;

  RETURN jsonb_build_object(
    'roles',    COALESCE(v_roles, '[]'::jsonb),
    'wallet',   COALESCE(v_user.wallet, 0),
    'user', jsonb_build_object(
      'id',            v_user.id,
      'phone',         v_user.phone,
      'full_name',     v_user.full_name,
      'is_guest',      v_user.is_guest,
      'guest_id',      v_user.guest_id,
      'referral_code', v_user.referral_code,
      'wallet',        COALESCE(v_user.wallet, 0)
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Ensure print_jobs.user_id accepts guest user IDs (already references users)
-- ─────────────────────────────────────────────────────────────────────────────
-- The user_id FK was added in the wallet_refund_system migration and already
-- references public.users(id), so guest user IDs work without any change.

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Update transactions RLS so guests can view their own transactions
-- ─────────────────────────────────────────────────────────────────────────────
-- Existing policy: "Users can view their transactions" uses auth.uid() = user_id
-- This already works for guests. No change needed.

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Inactivity deduction should skip guest accounts
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deduct_inactivity_fees()
RETURNS void AS $$
BEGIN
  INSERT INTO public.transactions (user_id, amount, type, status)
  SELECT id, -10, 'deduction', 'completed'
  FROM public.users
  WHERE last_active_at < now() - INTERVAL '30 days'
    AND wallet > 0
    AND is_guest = FALSE;  -- Do NOT deduct from guest wallets

  UPDATE public.users
  SET wallet = GREATEST(0, wallet - 10)
  WHERE last_active_at < now() - INTERVAL '30 days'
    AND wallet > 0
    AND is_guest = FALSE;
END;
$$ LANGUAGE plpgsql;
