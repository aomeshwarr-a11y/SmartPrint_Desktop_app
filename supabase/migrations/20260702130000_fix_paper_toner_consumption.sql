-- =============================================================================
-- CRITICAL FIX: Paper and Toner Consumption Pipeline
-- 
-- ROOT CAUSES IDENTIFIED:
-- 1. dropped triggers: The old trigger trg_handle_consumables_on_job_completion 
--    was dropped in migration 20260630000003. Deductions were moved to the 
--    complete_print_job RPC.
-- 2. Windows agent direct updates: The Windows agent completes jobs by calling the 
--    Vercel API endpoint /api/jobs/[id]/completed, which performs a direct SQL update
--    on print_jobs.status -> 'completed'. Since the trigger was dropped, this direct
--    update bypassed complete_print_job RPC, resulting in ZERO consumables deducted
--    and ZERO logs written for all Windows prints.
-- 3. Raspberry Pi agent local errors: The Linux agent tries to select auto_pause and 
--    auto_pause_threshold columns in deduct_paper/deduct_toner local python functions.
--    These columns do not exist in the database, causing the local updates to throw
--    exceptions and fail.
-- 4. status 'printed': In some production setups, print jobs status was updated to 
--    'printed', which also bypassed complete_print_job RPC.
--
-- THE SOLUTION:
-- A. Create a unified database trigger on print_jobs BEFORE UPDATE OF status.
--    When status transitions to any terminal status ('completed', 'done', 'printed')
--    and payment_status = 'paid', and paper/toner has not yet been deducted, 
--    the database handles the deduction and logs creation atomically.
-- B. This acts as a single, bulletproof source of truth that catches all updates
--    (complete_print_job RPC, Vercel API direct updates, custom status 'printed' updates).
-- C. Redefine complete_print_job RPC to simply update print_jobs.status to 'completed',
--    letting the trigger handle all deductions and logs atomically.
-- D. Clean up local python functions in agent.py to let the database handle the writes.
-- =============================================================================

-- 1. Create the unified trigger function
CREATE OR REPLACE FUNCTION public.handle_consumables_on_status_change()
RETURNS TRIGGER AS $$
DECLARE
  v_printer RECORD;
  v_sheets_to_deduct INTEGER;
  v_toner_to_deduct INTEGER;
  v_old_paper_remaining INTEGER;
  v_new_paper_remaining INTEGER;
  v_old_toner_remaining INTEGER;
  v_new_toner_remaining INTEGER;
  v_pages_to_print INTEGER;
  v_copies INTEGER;
  v_double_sided BOOLEAN;
  v_log_msg TEXT;
BEGIN
  -- Trigger only when status transitions to a terminal status ('completed', 'done', 'printed')
  -- and job is paid and has not yet had consumables deducted.
  IF (NEW.status IN ('completed', 'done', 'printed')) AND 
     (NEW.payment_status = 'paid') AND 
     (NOT NEW.paper_deducted OR NOT NEW.toner_deducted) THEN

    -- Fetch and lock printer
    SELECT * INTO v_printer FROM public.printers WHERE id = NEW.printer_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE WARNING '[handle_consumables_on_status_change] Printer % not found for job %', NEW.printer_id, NEW.id;
      RETURN NEW;
    END IF;

    v_pages_to_print := COALESCE(NEW.pages_to_print, NEW.total_pages, 1);
    v_copies := COALESCE(NEW.copies, 1);
    v_double_sided := COALESCE(NEW.double_sided, FALSE);

    -- A. Paper Deduction Block
    IF NOT NEW.paper_deducted THEN
      IF v_double_sided THEN
        v_sheets_to_deduct := CEIL(v_pages_to_print::NUMERIC / 2.0) * v_copies;
      ELSE
        v_sheets_to_deduct := v_pages_to_print * v_copies;
      END IF;

      v_old_paper_remaining := v_printer.paper_remaining;
      
      IF COALESCE(v_printer.paper_monitoring_enabled, TRUE) THEN
        v_new_paper_remaining := GREATEST(0, v_printer.paper_remaining - v_sheets_to_deduct);
      ELSE
        v_new_paper_remaining := v_printer.paper_remaining;
      END IF;

      -- Update printer paper level
      UPDATE public.printers
      SET paper_remaining = v_new_paper_remaining,
          updated_at = now()
      WHERE id = v_printer.id;

      -- Mark job paper_deducted = TRUE (since it's a BEFORE trigger, we modify NEW row directly)
      NEW.paper_deducted := TRUE;

      -- Log paper details
      INSERT INTO public.paper_consumption_logs (
        printer_id, job_id, pages, copies, double_sided, sheets_consumed, old_remaining, new_remaining
      ) VALUES (
        v_printer.id, NEW.id, v_pages_to_print, v_copies, v_double_sided, v_sheets_to_deduct, v_old_paper_remaining, v_new_paper_remaining
      );

      v_log_msg := format('TRIGGER PAPER DEDUCTION: Printer ID: %s, Job ID: %s, Pages: %s, Copies: %s, Double sided: %s, Sheets consumed: %s, Old remaining: %s, New remaining: %s, Timestamp: %s',
        v_printer.id, NEW.id, v_pages_to_print, v_copies, v_double_sided, v_sheets_to_deduct, v_old_paper_remaining, v_new_paper_remaining, now());
      RAISE LOG '%', v_log_msg;
      
      -- Reload printer record to get updated levels for toner block
      SELECT * INTO v_printer FROM public.printers WHERE id = v_printer.id FOR UPDATE;
    END IF;

    -- B. Toner Deduction Block
    IF NOT NEW.toner_deducted THEN
      v_toner_to_deduct := v_pages_to_print * v_copies;

      v_old_toner_remaining := v_printer.toner_remaining;
      
      IF COALESCE(v_printer.toner_monitoring_enabled, TRUE) THEN
        v_new_toner_remaining := GREATEST(0, v_printer.toner_remaining - v_toner_to_deduct);
      ELSE
        v_new_toner_remaining := v_printer.toner_remaining;
      END IF;

      -- Update printer toner level
      UPDATE public.printers
      SET toner_remaining = v_new_toner_remaining,
          updated_at = now()
      WHERE id = v_printer.id;

      -- Mark job toner_deducted = TRUE
      NEW.toner_deducted := TRUE;

      -- Log toner details
      INSERT INTO public.toner_consumption_logs (
        printer_id, job_id, pages, copies, toner_consumed, old_remaining, new_remaining
      ) VALUES (
        v_printer.id, NEW.id, v_pages_to_print, v_copies, v_toner_to_deduct, v_old_toner_remaining, v_new_toner_remaining
      );

      v_log_msg := format('TRIGGER TONER DEDUCTION: Printer ID: %s, Job ID: %s, Pages: %s, Copies: %s, Toner consumed: %s, Old remaining: %s, New remaining: %s, Timestamp: %s',
        v_printer.id, NEW.id, v_pages_to_print, v_copies, v_toner_to_deduct, v_old_toner_remaining, v_new_toner_remaining, now());
      RAISE LOG '%', v_log_msg;
    END IF;

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Register the trigger on print_jobs table
DROP TRIGGER IF EXISTS trg_handle_consumables_on_status_change ON public.print_jobs;
CREATE TRIGGER trg_handle_consumables_on_status_change
  BEFORE UPDATE OF status ON public.print_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_consumables_on_status_change();


-- 3. Simplify complete_print_job RPC to delegate deduction to trigger
CREATE OR REPLACE FUNCTION public.complete_print_job(
  p_job_id uuid,
  p_user_id uuid DEFAULT NULL,
  p_pages integer DEFAULT 1,
  p_amount numeric DEFAULT 0,
  p_printer_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_file_name text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Mark job status as 'completed' (this status change will fire the BEFORE UPDATE trigger and deduct consumables)
  UPDATE public.print_jobs
  SET status = 'completed',
      completed_at = now()
  WHERE id = p_job_id;

  -- Log in prints table (if user_id provided)
  IF p_user_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN
      INSERT INTO public.prints (user_id, pages, amount_paid)
      VALUES (p_user_id, p_pages, p_amount);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'job_id', p_job_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_print_job(uuid, uuid, integer, numeric, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_print_job(uuid, uuid, integer, numeric, uuid, uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.complete_print_job(uuid, uuid, integer, numeric, uuid, uuid, text) TO service_role;
