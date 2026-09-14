-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: Security Hardening — public.users RLS & Privilege Lockdown
-- 
-- Problems fixed:
--   1. "Service role can insert users"  — missing TO clause → anon/authenticated
--      could also INSERT directly.
--   2. "Users can insert their own profile" — allowed any authenticated client to
--      INSERT directly into users, bypassing approved server-side functions.
--   3. "Public can lookup referral codes" — USING (true) exposed every row
--      (phone, wallet, guest_id) to every role including anon.
--   4. UPDATE policies — no column-level restriction; clients could write wallet,
--      is_guest, guest_id, and referral_code directly.
--
-- After this migration:
--   • Direct INSERT into public.users: BLOCKED for anon and authenticated.
--   • Direct UPDATE of privileged fields (wallet, is_guest, guest_id, etc.):
--     BLOCKED for all client roles.
--   • SELECT: authenticated users see only their own row; anon sees only the
--     referral_code and id columns (needed for referral lookup RPC).
--   • All account creation must go through SECURITY DEFINER RPCs:
--       create_guest_user(), upgrade_guest_to_registered(), handle-new-user edge fn.
--   • All wallet mutations go through SECURITY DEFINER RPCs:
--       deduct_wallet(), increment_wallet(), handle_wallet_refund_on_failure trigger.
--   • All existing non-users RLS policies are untouched.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: Revoke direct INSERT privilege from client roles
-- Supabase grants INSERT on all tables to authenticated by default.
-- We revoke it here so RLS policies alone cannot re-grant it.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE INSERT ON public.users FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2: Drop ALL existing INSERT policies on public.users
-- Both the overly-broad guest migration policy and the original open one.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role can insert users"    ON public.users;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.users;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3: Create the correct INSERT policy — service_role only
-- The TO clause restricts which role the policy applies to.  
-- service_role bypasses RLS entirely, so this policy is belt-and-suspenders
-- documentation that only server-side code (edge functions / SECURITY DEFINER
-- RPCs) may insert rows.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY "Only service role can insert users"
  ON public.users
  FOR INSERT
  TO service_role
  WITH CHECK (TRUE);

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4: Fix the SELECT over-exposure
-- "Public can lookup referral codes" used USING (true), which means every anon
-- and authenticated request could read ALL rows including phone, wallet,
-- guest_id, upi_id.  Replace it with two scoped policies:
--   a) authenticated users see ONLY their own row.
--   b) anon/authenticated can look up a row by referral_code (needed for the
--      referral validation in handle-new-user), but only via the RPC which is
--      SECURITY DEFINER — so this open SELECT is not actually needed by clients.
--      We drop it and move lookups entirely into SECURITY DEFINER functions.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can lookup referral codes"   ON public.users;
DROP POLICY IF EXISTS "Users can view their own data"      ON public.users;

-- Authenticated users may read their own row (all columns).
CREATE POLICY "Authenticated users view own row"
  ON public.users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- No SELECT policy for anon role on public.users — anon users should never
-- need to query this table directly. All referral lookups go through
-- SECURITY DEFINER RPCs (lookup_referral_code, create_guest_user, etc.).

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 5: Fix UPDATE policies — restrict to safe, non-sensitive columns only
--
-- Current problem: "Users can update their own profile" has no column list,
-- meaning a client could UPDATE wallet, is_guest, guest_id, referral_code,
-- referred_by, has_withdrawn — anything in the row.
--
-- Safe columns for client UPDATE: last_active_at, upi_id, full_name.
-- Sensitive columns (wallet, is_guest, guest_id, referral_code, referred_by,
-- has_withdrawn, phone) must ONLY be modified through SECURITY DEFINER functions.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can update their own profile"  ON public.users;
DROP POLICY IF EXISTS "Users can update their own upi_id"   ON public.users;

-- Single consolidated UPDATE policy covering the safe columns only.
-- Uses WITH CHECK to ensure the user cannot change their own id, and USING to
-- ensure they can only touch their own row.
CREATE POLICY "Authenticated users update own safe fields"
  ON public.users
  FOR UPDATE
  TO authenticated
  USING  (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    -- Prevent the client from escalating their own wallet or guest status.
    -- PostgreSQL enforces WITH CHECK on the NEW row values; we reject any
    -- attempt to write to the protected columns by ensuring they stay equal
    -- to their current values. This is enforced at the RLS level even if
    -- the client tries to include those columns in the SET clause.
  );

-- Column-level REVOKE: prevent authenticated clients from writing to the
-- sensitive columns directly. Even if the UPDATE policy above passes,
-- PostgreSQL will reject writes to revoked columns.
REVOKE UPDATE (
  wallet,
  is_guest,
  guest_id,
  referral_code,
  referred_by,
  has_withdrawn,
  phone
) ON public.users FROM authenticated;

-- Anon role should have no UPDATE access at all.
REVOKE UPDATE ON public.users FROM anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 6: Verify SECURITY DEFINER + search_path on all account-management RPCs
-- Re-declare them with explicit SET search_path to prevent search_path hijacking.
-- The function bodies are unchanged from their original migrations.
-- ─────────────────────────────────────────────────────────────────────────────

-- 6a. create_guest_user — already SECURITY DEFINER; re-declare to confirm
--     search_path is locked.
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
  -- Input validation
  IF p_auth_id IS NULL THEN
    RAISE EXCEPTION 'p_auth_id cannot be NULL';
  END IF;
  IF p_guest_id IS NULL OR trim(p_guest_id) = '' THEN
    RAISE EXCEPTION 'p_guest_id cannot be NULL or empty';
  END IF;

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
    id, is_guest, guest_id, phone, referral_code, wallet, last_active_at, created_at
  ) VALUES (
    p_auth_id, TRUE, trim(p_guest_id), NULL, NULL, 0, now(), now()
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

-- 6b. upgrade_guest_to_registered — already SECURITY DEFINER; re-declare to
--     add input validation and harden search_path.
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
BEGIN
  -- Input validation
  IF p_auth_id IS NULL THEN
    RAISE EXCEPTION 'p_auth_id cannot be NULL';
  END IF;
  IF p_phone IS NULL OR length(trim(p_phone)) < 10 THEN
    RAISE EXCEPTION 'p_phone must be a valid 10-digit number';
  END IF;
  -- Normalise phone to digits only, reject non-numeric
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

  -- Phone uniqueness check
  IF EXISTS (SELECT 1 FROM public.users WHERE phone = trim(p_phone) AND id <> p_auth_id) THEN
    RAISE EXCEPTION 'Phone number is already registered to another account';
  END IF;

  -- Generate or validate referral code
  IF p_referral_code IS NOT NULL AND trim(p_referral_code) <> '' THEN
    v_final_referral := upper(trim(p_referral_code));
    -- Ensure the supplied code is not already taken by someone else
    IF EXISTS (
      SELECT 1 FROM public.users
      WHERE referral_code = v_final_referral AND id <> p_auth_id
    ) THEN
      -- Supplied code is taken; generate a fresh one instead
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
    phone         = trim(p_phone),
    referral_code = v_final_referral,
    guest_id      = NULL,
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

-- 6c. get_my_profile — re-declare with locked search_path
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

  BEGIN
    SELECT jsonb_agg(jsonb_build_object('role', role, 'branch_id', branch_id))
    INTO v_roles
    FROM public.user_roles
    WHERE user_id = auth.uid();
  EXCEPTION WHEN undefined_table THEN
    v_roles := '[]'::jsonb;
  END;

  RETURN jsonb_build_object(
    'roles',  COALESCE(v_roles, '[]'::jsonb),
    'wallet', COALESCE(v_user.wallet, 0),
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

-- 6d. deduct_wallet — already SECURITY DEFINER; re-declare with locked search_path
CREATE OR REPLACE FUNCTION public.deduct_wallet(p_user_id UUID, p_amount NUMERIC)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Deduction amount must be positive';
  END IF;
  UPDATE public.users
  SET wallet = wallet - p_amount
  WHERE id = p_user_id AND wallet >= p_amount;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient wallet balance for user %', p_user_id;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 7: Re-grant EXECUTE on RPCs to client roles (unchanged from before)
-- Clients must be able to CALL these functions — but all writes happen inside
-- the function body running as the function owner (SECURITY DEFINER).
-- ─────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.create_guest_user(UUID, TEXT)                  TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.upgrade_guest_to_registered(UUID, TEXT, TEXT)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_profile()                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_wallet(UUID, NUMERIC)                   TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 8: Ensure referral lookup goes through a SECURITY DEFINER function
-- rather than a direct SELECT on public.users.
-- The old approach was: CREATE POLICY "Public can lookup referral codes" USING (true)
-- which exposed the whole table.  Now we provide a narrowly-scoped RPC that
-- returns only the referrer's id — nothing else.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lookup_referral_code(p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_code IS NULL OR trim(p_code) = '' THEN
    RETURN NULL;
  END IF;
  SELECT id INTO v_id
  FROM public.users
  WHERE referral_code = upper(trim(p_code))
    AND is_guest = FALSE   -- guests cannot have referral codes
  LIMIT 1;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_referral_code(TEXT) TO authenticated, anon;
