-- =============================================================================
-- Migration: Desktop App Signup - Shop Owner Role Assignment (LOCAL DRAFT ONLY)
--
-- THIS FILE HAS NOT BEEN EXECUTED AGAINST PRODUCTION.
-- It establishes the database security boundary for SmartPrinter Desktop:
--
-- 1. Cleans up any insecure client-controlled metadata triggers or RPC functions.
--    Desktop registrations are handled securely via the server-controlled
--    'desktop-signup' Edge Function running with service_role credentials.
-- 2. RLS policy on public.branches allowing authenticated users with 'shop_owner'
--    or 'branch_owner' to create and manage their own branch (owner_id = auth.uid()).
-- 3. Protects existing roles:
--    - Admin users are strictly protected.
--    - Existing branch/branch_owner staff roles are untouched.
--    - Web/kiosk customer signups remain isolated and role-free.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Drop any insecure client-metadata triggers or self-promotion RPCs
--    (Desktop signup role assignment is server-enforced in desktop-signup function)
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_handle_desktop_user_role ON auth.users;
DROP FUNCTION IF EXISTS public.handle_desktop_user_role();
DROP FUNCTION IF EXISTS public.ensure_desktop_user_role();

-- ---------------------------------------------------------------------------
-- 2. RLS Policy on public.branches for Shop Setup
--    Allows authenticated shop owners to create their own branch.
--    Enforces:
--      - owner_id must match auth.uid() (cannot create a branch for another user)
--      - Caller must have shop_owner or branch_owner role, or be platform admin
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'branches'
      AND policyname = 'Shop owners can create branches'
  ) THEN
    CREATE POLICY "Shop owners can create branches"
      ON public.branches
      FOR INSERT
      TO authenticated
      WITH CHECK (
        owner_id = auth.uid()
        AND (
          public.is_admin()
          OR EXISTS (
            SELECT 1 FROM public.user_roles
            WHERE user_id = auth.uid()
              AND role::text IN ('shop_owner', 'branch_owner')
          )
        )
      );
  END IF;
END $$;
