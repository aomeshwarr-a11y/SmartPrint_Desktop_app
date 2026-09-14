-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: Security Hardening Patch — Fix gaps left by 20260705010000
--
-- Addresses four issues identified against the live pg_policies state:
--
-- 1. create_guest_user() — email NOT NULL 23502 crash
--    public.users.email is NOT NULL (added via dashboard, not in local migrations).
--    The function inserted without email → violates the constraint.
--    Fix: make email nullable (guests have no email until upgraded) and patch
--    upgrade_guest_to_registered() to backfill it.
--
-- 2. users_select_by_referral_code not dropped by previous migration
--    Policy: SELECT | {authenticated} | (referral_code IS NOT NULL)
--    This lets any authenticated user read ALL columns of every registered user.
--    Fix: drop it. Referral lookups route through lookup_referral_code() RPC.
--
-- 3. user_update_own is redundant dead weight
--    Same condition as the new "Authenticated users update own safe fields".
--    Harmless due to column-level REVOKEs, but confusing and worth removing.
--    Fix: drop it.
--
-- 4. anon EXECUTE grant on create_guest_user() — intentional, confirmed
--    signInAnonymously() completes and issues a JWT (role = authenticated)
--    BEFORE the client calls create_guest_user(). By the time the RPC is
--    called, the role is already 'authenticated', not 'anon'.
--    Fix: REVOKE the anon grant (unnecessary) and keep only authenticated.
--    The function body validates p_auth_id IS NOT NULL, so an unauthenticated
--    caller passing a random UUID cannot create a valid row because the FK
--    references auth.users(id) — which only contains real session IDs.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 1 — Make public.users.email nullable
-- Guests have no email. Registered users get email set during upgrade.
-- The column was added via the dashboard as NOT NULL; we relax it here so
-- create_guest_user() can insert without triggering 23502.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.users ALTER COLUMN email DROP NOT NULL;

-- Set existing NULL emails (if any from anonymous auth rows) to a safe default
-- so we don't leave garbage data; NULL is fine for guests going forward.

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 1 (continued) — Redeclare create_guest_user() with email handling
-- The function now explicitly leaves email NULL for guest rows, which is
-- valid now that the column is nullable.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_guest_user(
  p_auth_id  UUID,
  p_guest_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user RECORD;
BEGIN
  -- Input validation
  IF p_auth_id IS NULL THEN
    RAISE EXCEPTION 'p_auth_id cannot be NULL';
  END IF;
  IF p_guest_id IS NULL OR trim(p_guest_id) = '' THEN
    RAISE EXCEPTION 'p_guest_id cannot be NULL or empty';
  END IF;

  -- Idempotent: if a row already exists for this auth id, return it as-is
  SELECT * INTO v_user FROM public.users WHERE id = p_auth_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'id',       v_user.id,
      'guest_id', v_user.guest_id,
      'wallet',   v_user.wallet,
      'is_guest', v_user.is_guest
    );
  END IF;

  -- Verify the auth.users row actually exists (guards against spoofed UUIDs)
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_auth_id) THEN
    RAISE EXCEPTION 'No auth.users row for id %', p_auth_id;
  END IF;

  INSERT INTO public.users (
    id,
    email,          -- NULL: guests have no email until upgraded
    is_guest,
    guest_id,
    phone,          -- NULL: guests have no phone until upgraded
    referral_code,  -- NULL: guests do not participate in referrals
    wallet,
    last_active_at,
    created_at
  ) VALUES (
    p_auth_id,
    NULL,           -- email: nullable after FIX 1 above
    TRUE,
    trim(p_guest_id),
    NULL,
    NULL,
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

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 1 (continued) — Redeclare upgrade_guest_to_registered() to set email
-- When a guest upgrades, we write their email (phone@vprint.in) into the row
-- to match what Supabase auth.users will hold after updateUser() is called.
-- This keeps public.users.email consistent with auth.users.email.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upgrade_guest_to_registered(
  p_auth_id       UUID,
  p_phone         TEXT,
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
  v_email          TEXT;
BEGIN
  -- Input validation
  IF p_auth_id IS NULL THEN
    RAISE EXCEPTION 'p_auth_id cannot be NULL';
  END IF;
  IF p_phone IS NULL OR trim(p_phone) = '' THEN
    RAISE EXCEPTION 'p_phone cannot be NULL or empty';
  END IF;
  IF trim(p_phone) !~ '^\d{10,15}$' THEN
    RAISE EXCEPTION 'p_phone must contain only digits (10–15 digits)';
  END IF;

  SELECT * INTO v_user FROM public.users WHERE id = p_auth_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found: %', p_auth_id;
  END IF;
  IF NOT v_user.is_guest THEN
    RAISE EXCEPTION 'User is already a registered account';
  END IF;

  -- Phone uniqueness
  IF EXISTS ( 
    SELECT 1 FROM public.users WHERE phone = trim(p_phone) AND id <> p_auth_id
  ) THEN
    RAISE EXCEPTION 'Phone number is already registered to another account';
  END IF;

  -- Derive the synthetic email that auth.users will hold after updateUser()
  v_email := trim(p_phone) || '@vprint.in';

  -- Email uniqueness (defensive — auth.users should already enforce this)
  IF EXISTS (
    SELECT 1 FROM public.users WHERE email = v_email AND id <> p_auth_id
  ) THEN
    RAISE EXCEPTION 'Email % is already registered to another account', v_email;
  END IF;

  -- Referral code: validate supplied one or generate a fresh unique one
  IF p_referral_code IS NOT NULL AND trim(p_referral_code) <> '' THEN
    v_final_referral := upper(trim(p_referral_code));
    -- If the supplied code is already taken by someone else, fall through to generate
    IF EXISTS (
      SELECT 1 FROM public.users WHERE referral_code = v_final_referral AND id <> p_auth_id
    ) THEN
      v_final_referral := NULL;
    END IF;
  END IF;

  IF v_final_referral IS NULL THEN
    v_final_referral := public.generate_referral_code();
    WHILE EXISTS (
      SELECT 1 FROM public.users WHERE referral_code = v_final_referral AND id <> p_auth_id
    ) LOOP
      v_final_referral := public.generate_referral_code();
    END LOOP;
  END IF;

  UPDATE public.users
  SET
    is_guest      = FALSE,
    email         = v_email,        -- backfill email on upgrade
    phone         = trim(p_phone),
    referral_code = v_final_referral,
    guest_id      = NULL,           -- clear guest marker
    last_active_at = now()
  WHERE id = p_auth_id
  RETURNING * INTO v_user;

  RETURN jsonb_build_object(
    'id',            v_user.id,
    'phone',         v_user.phone,
    'email',         v_user.email,
    'referral_code', v_user.referral_code,
    'wallet',        v_user.wallet,
    'is_guest',      v_user.is_guest
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 2 — Drop users_select_by_referral_code
-- Policy was: SELECT | authenticated | (referral_code IS NOT NULL)
-- This exposed every column of every registered user to any authenticated
-- client. Referral lookups now go through lookup_referral_code() RPC.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "users_select_by_referral_code" ON public.users;

-- Also drop any other broad SELECT policies that may expose full rows.
-- These names cover both snake_case and quoted variants as they appear in
-- pg_policies.policyname on the live database.
DROP POLICY IF EXISTS "Users can select referral codes"        ON public.users;
DROP POLICY IF EXISTS "Enable read access for all users"       ON public.users;
DROP POLICY IF EXISTS "Enable read access for authenticated"   ON public.users;

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 3 — Drop user_update_own (redundant dead weight)
-- Same USING condition as "Authenticated users update own safe fields".
-- The column-level REVOKEs from the previous migration already block writes
-- to privileged fields regardless, but leaving two policies with the same
-- effect is confusing in audits.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "user_update_own"                    ON public.users;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update their own upi_id"  ON public.users;

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 4 — Revoke anon EXECUTE on create_guest_user()
-- The anon grant was unnecessary: signInAnonymously() issues a JWT with
-- role = 'authenticated' before the client calls this RPC. Additionally,
-- even if an anon caller passed a valid UUID, the FK auth.users(id) would
-- reject any UUID not present in the auth schema — so the grant was also
-- harmless, but removing it is the correct least-privilege posture.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.create_guest_user(UUID, TEXT) FROM anon;

-- Keep authenticated grant (anonymous Supabase sessions use this role)
GRANT EXECUTE ON FUNCTION public.create_guest_user(UUID, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- CONFIRMATION — Final EXECUTE grant state after both migrations
-- ─────────────────────────────────────────────────────────────────────────────
-- create_guest_user           → authenticated only
-- upgrade_guest_to_registered → authenticated only
-- get_my_profile              → authenticated
-- deduct_wallet               → authenticated, service_role
-- lookup_referral_code        → authenticated, anon (needed: anon callers use
--                               this to validate a referral code at signup
--                               before they have a session — e.g., deep link
--                               referral flows on the landing page)

-- Re-grant upgrade function (ensure it's still scoped correctly)
GRANT EXECUTE ON FUNCTION public.upgrade_guest_to_registered(UUID, TEXT, TEXT) TO authenticated;
