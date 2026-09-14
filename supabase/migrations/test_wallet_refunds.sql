-- Test Suite for Wallet Refund System
-- Run this in your Supabase SQL editor or pgAdmin to verify all requirements.

BEGIN;

-- =============================================================================
-- 0. SETUP: Create Test User and Printer
-- =============================================================================
SELECT '=== 0. SETUP ===' as step;

-- Create an auth user if it doesn't exist
INSERT INTO auth.users (id, email, phone, raw_user_meta_data)
VALUES (
  '99999999-9999-9999-9999-999999999999',
  'refund_tester@smartprinter.in',
  '+919999999999',
  '{"name": "Refund Tester"}'
)
ON CONFLICT (id) DO NOTHING;

-- Create a profile in public.users
INSERT INTO public.users (id, phone, referral_code, wallet, last_active_at)
VALUES (
  '99999999-9999-9999-9999-999999999999',
  '+919999999999',
  'TESTREF',
  100.00, -- Initial wallet balance: ₹100
  now()
)
ON CONFLICT (id) DO UPDATE
SET wallet = 100.00;

-- Create a test printer
INSERT INTO public.printers (id, name, location, status, price_per_page, paper_remaining)
VALUES (
  '88888888-8888-8888-8888-888888888888',
  'Test Refund Printer',
  'Test Kiosk',
  'online',
  2.00,
  500
)
ON CONFLICT (id) DO NOTHING;


-- =============================================================================
-- Scenario 1: Successful Print Job (No Refund)
-- =============================================================================
SELECT '=== Scenario 1: Successful Print Job (No Refund) ===' as step;

INSERT INTO public.print_jobs (
  id, printer_id, user_id, status, payment_status, total_price, files, session_token
) VALUES (
  '11111111-1111-1111-1111-111111111111',
  '88888888-8888-8888-8888-888888888888',
  '99999999-9999-9999-9999-999999999999',
  'queued',
  'paid',
  10.00,
  '[]'::jsonb,
  gen_random_uuid()
);

-- Complete the job
UPDATE public.print_jobs SET status = 'completed' WHERE id = '11111111-1111-1111-1111-111111111111';

-- Verify: Wallet should still be ₹100.00, refund_status should be 'pending'
SELECT wallet FROM public.users WHERE id = '99999999-9999-9999-9999-999999999999';
SELECT refund_status, refund_reason FROM public.print_jobs WHERE id = '11111111-1111-1111-1111-111111111111';


-- =============================================================================
-- Scenario 2: Failed Print Job - System Error (Eligible for Refund)
-- =============================================================================
SELECT '=== Scenario 2: Failed Print Job - System Error (Eligible for Refund) ===' as step;

INSERT INTO public.print_jobs (
  id, printer_id, user_id, status, payment_status, total_price, files, session_token
) VALUES (
  '22222222-2222-2222-2222-222222222222',
  '88888888-8888-8888-8888-888888888888',
  '99999999-9999-9999-9999-999999999999',
  'queued',
  'paid',
  15.00,
  '[]'::jsonb,
  gen_random_uuid()
);

-- Mark the job as failed with eligible error (e.g. Printer Offline)
UPDATE public.print_jobs 
SET status = 'failed', 
    error_message = 'Printer Offline: Raspberry Pi Agent Disconnected' 
WHERE id = '22222222-2222-2222-2222-222222222222';

-- Verify: Wallet should be credited to ₹115.00 (+15.00), refund_status should be 'refunded'
SELECT wallet FROM public.users WHERE id = '99999999-9999-9999-9999-999999999999';
SELECT refund_status, refund_reason, refund_processed_at FROM public.print_jobs WHERE id = '22222222-2222-2222-2222-222222222222';

-- Verify: Transaction log should show the refund of ₹15.00
SELECT * FROM public.transactions WHERE user_id = '99999999-9999-9999-9999-999999999999' AND type = 'refund';


-- =============================================================================
-- Scenario 3: Idempotency - Duplicate Refund Prevention
-- =============================================================================
SELECT '=== Scenario 3: Idempotency - Duplicate Refund Prevention ===' as step;

-- A. Try updating the failed job again (e.g. agent retries reporting the failure)
UPDATE public.print_jobs 
SET error_message = 'Printer Offline: Pi Agent Disconnected - Retry Attempt 2' 
WHERE id = '22222222-2222-2222-2222-222222222222';

-- Verify: Wallet should STILL be ₹115.00 (no duplicate refund)
SELECT wallet FROM public.users WHERE id = '99999999-9999-9999-9999-999999999999';

-- B. Try explicitly resetting status to failed and tampering with the refund fields
UPDATE public.print_jobs 
SET status = 'failed',
    refund_status = 'pending',
    refund_reason = 'tamper'
WHERE id = '22222222-2222-2222-2222-222222222222';

-- Verify: Wallet remains ₹115.00, and refund columns were NOT overwritten
SELECT wallet FROM public.users WHERE id = '99999999-9999-9999-9999-999999999999';
SELECT refund_status, refund_reason FROM public.print_jobs WHERE id = '22222222-2222-2222-2222-222222222222';


-- =============================================================================
-- Scenario 4: Failed Print Job - User Error (NOT Eligible for Refund)
-- =============================================================================
SELECT '=== Scenario 4: Failed Print Job - User Error (NOT Eligible) ===' as step;

INSERT INTO public.print_jobs (
  id, printer_id, user_id, status, payment_status, total_price, files, session_token
) VALUES (
  '33333333-3333-3333-3333-333333333333',
  '88888888-8888-8888-8888-888888888888',
  '99999999-9999-9999-9999-999999999999',
  'queued',
  'paid',
  25.00,
  '[]'::jsonb,
  gen_random_uuid()
);

-- Fail the job with user error (e.g. user cancelled print job)
UPDATE public.print_jobs 
SET status = 'failed', 
    error_message = 'Cancellation: User manually cancelled before printing' 
WHERE id = '33333333-3333-3333-3333-333333333333';

-- Verify: Wallet should STILL be ₹115.00 (no refund), refund_status should be 'not_eligible'
SELECT wallet FROM public.users WHERE id = '99999999-9999-9999-9999-999999999999';
SELECT refund_status, refund_reason FROM public.print_jobs WHERE id = '33333333-3333-3333-3333-333333333333';

ROLLBACK;
