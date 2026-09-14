-- =============================================================================
-- CRITICAL FIX: Paper Availability Root Cause
-- 
-- BUG SUMMARY:
--   Branch Dashboard shows paper_remaining directly from printers table (e.g. 10).
--   Payment Page calls get_available_paper() which returned 0.
--
-- ROOT CAUSES IDENTIFIED:
--
-- 1. STALE QUEUED/PRINTING JOBS — The v_reserved_paid block in get_available_paper()
--    counts ALL print_jobs WHERE status IN ('queued','printing') AND payment_status='paid'.
--    If old/stuck jobs were never transitioned to 'completed' or 'failed', they
--    permanently consume paper capacity, making available paper = 0 even when
--    the tray is full (paper_remaining = 10).
--
-- 2. NO TIMEOUT ON QUEUED JOBS — There is no maximum age limit on jobs in the
--    'queued' or 'printing' state. A job stuck for hours/days still reduces
--    available paper as if it will print any second.
--
-- 3. RESERVATION EXPIRY DOES NOT CLEAN PRINT_JOBS — When a 10-minute pending
--    reservation expires, the paper_reservations row becomes invisible to
--    get_available_paper() (due to expires_at > now() filter). But the print_job
--    itself stays in status='pending' with payment_status='pending'. If someone
--    later pays for that same job, it correctly moves to queued. This is fine.
--    However stale 'queued' jobs that never got to complete_print_job are
--    the real problem.
--
-- 4. ORPHANED RESERVATIONS — If a user creates a job then abandons it without
--    paying, the reservation expires (correctly excluded by get_available_paper).
--    But if payment succeeds but the printer agent never calls complete_print_job,
--    the job stays 'queued'+'paid' forever and keeps consuming paper in the
--    v_reserved_paid calculation.
--
-- FIXES IN THIS MIGRATION:
--   A. Rewrite get_available_paper() to use a 4-hour timeout on queued/printing
--      jobs. Jobs older than 4 hours in queued/printing state are NOT counted.
--   B. Add a function to auto-fail stale queued/printing jobs older than 4 hours.
--   C. Clean up any existing stale jobs right now.
--   D. Add an index to speed up the paper calculation queries.
--   E. Add detailed diagnostic logging to get_available_paper().
-- =============================================================================

-- -----------------------------------------------------------------------------
-- STEP 1: Rewrite get_available_paper() with stale-job protection
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_available_paper(
  p_printer_id UUID,
  p_exclude_job_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_paper_remaining   INTEGER;
  v_paper_monitoring  BOOLEAN;
  v_reserved_pending  INTEGER;
  v_reserved_paid     INTEGER;
  v_stale_cutoff      TIMESTAMP WITH TIME ZONE;
  v_available         INTEGER;
BEGIN
  -- Fetch printer's paper_remaining and monitoring flag
  SELECT paper_remaining, paper_monitoring_enabled
    INTO v_paper_remaining, v_paper_monitoring
    FROM public.printers
   WHERE id = p_printer_id;

  IF NOT FOUND THEN
    RAISE WARNING '[get_available_paper] Printer % not found', p_printer_id;
    RETURN 0;
  END IF;

  -- If paper monitoring is disabled, return a very high number
  IF NOT COALESCE(v_paper_monitoring, TRUE) THEN
    RETURN 999999;
  END IF;

  -- Jobs stuck in queued/printing for more than 4 hours are treated as stale
  -- and are NOT counted as consuming paper.
  v_stale_cutoff := now() - INTERVAL '4 hours';

  -- ----------------------------------------------------------------
  -- v_reserved_pending: sheets reserved for jobs that are still 
  -- awaiting payment (payment_status = 'pending').
  -- Only non-expired reservations count. Current job is excluded.
  -- ----------------------------------------------------------------
  SELECT COALESCE(SUM(r.sheets), 0)
    INTO v_reserved_pending
    FROM public.paper_reservations r
    JOIN public.print_jobs j ON j.id = r.job_id
   WHERE r.printer_id = p_printer_id
     AND r.expires_at > now()                       -- only live reservations
     AND j.payment_status = 'pending'               -- only unpaid jobs
     AND (p_exclude_job_id IS NULL OR r.job_id != p_exclude_job_id);

  -- ----------------------------------------------------------------
  -- v_reserved_paid: sheets for paid jobs that are actively queued
  -- or printing, but NOT stale (created within the last 4 hours).
  -- Current job is excluded.
  -- ----------------------------------------------------------------
  SELECT COALESCE(SUM(
    CASE
      WHEN j.double_sided THEN CEIL(j.pages_to_print::NUMERIC / 2.0) * j.copies
      ELSE j.pages_to_print * j.copies
    END
  ), 0)
    INTO v_reserved_paid
    FROM public.print_jobs j
   WHERE j.printer_id = p_printer_id
     AND j.payment_status = 'paid'
     AND j.status IN ('queued', 'printing')
     AND j.created_at >= v_stale_cutoff              -- ONLY non-stale jobs
     AND (p_exclude_job_id IS NULL OR j.id != p_exclude_job_id);

  v_available := GREATEST(0, COALESCE(v_paper_remaining, 500) - v_reserved_pending - v_reserved_paid);

  -- Diagnostic log (visible in Supabase logs)
  RAISE LOG '[get_available_paper] printer=% paper_remaining=% reserved_pending=% reserved_paid=% available=% stale_cutoff=%',
    p_printer_id, v_paper_remaining, v_reserved_pending, v_reserved_paid, v_available, v_stale_cutoff;

  RETURN v_available;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_available_paper(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_available_paper(UUID, UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_available_paper(UUID, UUID) TO service_role;


-- -----------------------------------------------------------------------------
-- STEP 2: Create function to auto-fail stale queued/printing jobs
-- Jobs that have been queued or printing for more than 4 hours without
-- completing are assumed to have failed (printer disconnected, agent crashed).
-- This prevents them from permanently consuming paper capacity.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_fail_stale_print_jobs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Fail jobs that have been stuck in queued/printing for > 4 hours
  UPDATE public.print_jobs
     SET status = 'failed',
         error_message = 'Auto-failed: job stuck in queued/printing state for over 4 hours',
         updated_at = now()
   WHERE payment_status = 'paid'
     AND status IN ('queued', 'printing')
     AND created_at < now() - INTERVAL '4 hours';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count > 0 THEN
    RAISE LOG '[auto_fail_stale_print_jobs] Auto-failed % stale jobs', v_count;
  END IF;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_fail_stale_print_jobs() TO service_role;
GRANT EXECUTE ON FUNCTION public.auto_fail_stale_print_jobs() TO authenticated;


-- -----------------------------------------------------------------------------
-- STEP 3: Clean up existing stale jobs RIGHT NOW
-- Run the auto-fail function immediately so the bug is fixed in production
-- without waiting for the next cron run.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT public.auto_fail_stale_print_jobs() INTO v_count;
  RAISE LOG '[MIGRATION 20260702120000] Cleaned up % stale queued/printing jobs', v_count;
END;
$$;


-- -----------------------------------------------------------------------------
-- STEP 4: Clean up orphaned paper_reservations
-- Reservations whose associated job is no longer 'pending' should not exist.
-- The trigger should handle this, but cleanup any that slipped through.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM public.paper_reservations r
  USING public.print_jobs j
  WHERE r.job_id = j.id
    AND j.payment_status != 'pending';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE LOG '[MIGRATION 20260702120000] Deleted % orphaned paper_reservations', v_count;
END;
$$;


-- -----------------------------------------------------------------------------
-- STEP 5: Also clean expired reservations (belt-and-suspenders)
-- The query in get_available_paper already filters by expires_at > now(),
-- but expired rows waste space and can cause confusion.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM public.paper_reservations
   WHERE expires_at <= now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE LOG '[MIGRATION 20260702120000] Deleted % expired paper_reservations', v_count;
END;
$$;


-- -----------------------------------------------------------------------------
-- STEP 6: Add indexes to speed up get_available_paper() calls
-- These queries run on every payment page load — they must be fast.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_paper_reservations_printer_expires
  ON public.paper_reservations (printer_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_print_jobs_paper_availability
  ON public.print_jobs (printer_id, payment_status, status, created_at)
  WHERE payment_status = 'paid' AND status IN ('queued', 'printing');


-- -----------------------------------------------------------------------------
-- STEP 7: Create get_paper_debug() diagnostic function
-- Call this from Supabase SQL editor to diagnose any future issues.
-- Usage: SELECT * FROM public.get_paper_debug('your-printer-uuid');
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_paper_debug(p_printer_id UUID)
RETURNS TABLE (
  label           TEXT,
  value           TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_paper_remaining   INTEGER;
  v_paper_monitoring  BOOLEAN;
  v_reserved_pending  INTEGER;
  v_reserved_paid     INTEGER;
  v_stale_cutoff      TIMESTAMP WITH TIME ZONE;
  v_available         INTEGER;
  v_stale_count       INTEGER;
BEGIN
  v_stale_cutoff := now() - INTERVAL '4 hours';

  SELECT paper_remaining, paper_monitoring_enabled
    INTO v_paper_remaining, v_paper_monitoring
    FROM public.printers
   WHERE id = p_printer_id;

  SELECT COALESCE(SUM(r.sheets), 0)
    INTO v_reserved_pending
    FROM public.paper_reservations r
    JOIN public.print_jobs j ON j.id = r.job_id
   WHERE r.printer_id = p_printer_id
     AND r.expires_at > now()
     AND j.payment_status = 'pending';

  SELECT COALESCE(SUM(
    CASE WHEN j.double_sided THEN CEIL(j.pages_to_print::NUMERIC / 2.0) * j.copies
         ELSE j.pages_to_print * j.copies END
  ), 0)
    INTO v_reserved_paid
    FROM public.print_jobs j
   WHERE j.printer_id = p_printer_id
     AND j.payment_status = 'paid'
     AND j.status IN ('queued', 'printing')
     AND j.created_at >= v_stale_cutoff;

  -- Count stale jobs (that are now excluded)
  SELECT COUNT(*)
    INTO v_stale_count
    FROM public.print_jobs j
   WHERE j.printer_id = p_printer_id
     AND j.payment_status = 'paid'
     AND j.status IN ('queued', 'printing')
     AND j.created_at < v_stale_cutoff;

  v_available := GREATEST(0, COALESCE(v_paper_remaining, 500) - v_reserved_pending - v_reserved_paid);

  RETURN QUERY VALUES
    ('printer_id',          p_printer_id::TEXT),
    ('paper_remaining',     COALESCE(v_paper_remaining, 500)::TEXT),
    ('paper_monitoring',    COALESCE(v_paper_monitoring, TRUE)::TEXT),
    ('reserved_pending',    v_reserved_pending::TEXT),
    ('reserved_paid',       v_reserved_paid::TEXT),
    ('stale_jobs_excluded', v_stale_count::TEXT),
    ('available_paper',     v_available::TEXT),
    ('stale_cutoff',        v_stale_cutoff::TEXT),
    ('timestamp',           now()::TEXT);

  -- Also dump individual stale jobs
  FOR label, value IN
    SELECT 'STALE_JOB: id=' || j.id::TEXT || ' status=' || j.status || ' created=' || j.created_at::TEXT,
           'sheets=' || (CASE WHEN j.double_sided THEN CEIL(j.pages_to_print::NUMERIC/2.0)*j.copies ELSE j.pages_to_print*j.copies END)::TEXT
      FROM public.print_jobs j
     WHERE j.printer_id = p_printer_id
       AND j.payment_status = 'paid'
       AND j.status IN ('queued', 'printing')
       AND j.created_at < v_stale_cutoff
  LOOP
    RETURN NEXT;
  END LOOP;

  -- Also dump active reservations
  FOR label, value IN
    SELECT 'ACTIVE_RESERVATION: job_id=' || r.job_id::TEXT || ' expires=' || r.expires_at::TEXT,
           'sheets=' || r.sheets::TEXT
      FROM public.paper_reservations r
      JOIN public.print_jobs j ON j.id = r.job_id
     WHERE r.printer_id = p_printer_id
       AND r.expires_at > now()
       AND j.payment_status = 'pending'
  LOOP
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_paper_debug(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_paper_debug(UUID) TO service_role;
