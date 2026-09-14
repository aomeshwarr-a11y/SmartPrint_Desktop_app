-- Migration to fix toner monitoring, duplicate deductions, and logging

-- 1. Create toner_consumption_logs table if not exists
CREATE TABLE IF NOT EXISTS public.toner_consumption_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  printer_id UUID NOT NULL REFERENCES public.printers(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.print_jobs(id) ON DELETE CASCADE,
  pages INTEGER NOT NULL,
  copies INTEGER NOT NULL,
  toner_consumed INTEGER NOT NULL,
  old_remaining INTEGER NOT NULL,
  new_remaining INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS on the logs table
ALTER TABLE public.toner_consumption_logs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist to avoid conflict
DROP POLICY IF EXISTS "Anyone can view toner consumption logs" ON public.toner_consumption_logs;
DROP POLICY IF EXISTS "Anyone can manage toner consumption logs" ON public.toner_consumption_logs;

-- Allow select and insert for anyone (matching other tables)
CREATE POLICY "Anyone can view toner consumption logs" ON public.toner_consumption_logs FOR SELECT USING (true);
CREATE POLICY "Anyone can manage toner consumption logs" ON public.toner_consumption_logs FOR ALL USING (true);

-- 2. Add toner_deducted column to print_jobs table if it doesn't exist
ALTER TABLE public.print_jobs ADD COLUMN IF NOT EXISTS toner_deducted BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Update complete_print_job RPC function to handle both paper and toner deduction atomically
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
DECLARE
  v_job RECORD;
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
  -- Fetch and lock the job row to ensure atomic transaction isolation
  SELECT * INTO v_job FROM public.print_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Job not found');
  END IF;

  -- 1. Mark job status as 'completed'
  UPDATE public.print_jobs
  SET status = 'completed',
      completed_at = now()
  WHERE id = p_job_id;

  -- 2. Log in prints table (if user_id provided)
  IF p_user_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN
      INSERT INTO public.prints (user_id, pages, amount_paid)
      VALUES (p_user_id, p_pages, p_amount);
    END IF;
  END IF;

  -- Fetch the printer and lock it
  SELECT * INTO v_printer FROM public.printers WHERE id = COALESCE(p_printer_id, v_job.printer_id) FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'message', 'Printer not found for deduction');
  END IF;

  v_pages_to_print := COALESCE(v_job.pages_to_print, v_job.total_pages, p_pages, 1);
  v_copies := COALESCE(v_job.copies, 1);
  v_double_sided := COALESCE(v_job.double_sided, FALSE);

  v_old_paper_remaining := v_printer.paper_remaining;
  v_new_paper_remaining := v_printer.paper_remaining;
  v_old_toner_remaining := v_printer.toner_remaining;
  v_new_toner_remaining := v_printer.toner_remaining;

  -- 3. Paper deduction block (protect from double deduction)
  IF NOT v_job.paper_deducted THEN
    IF v_double_sided THEN
      v_sheets_to_deduct := CEIL(v_pages_to_print::NUMERIC / 2.0) * v_copies;
    ELSE
      v_sheets_to_deduct := v_pages_to_print * v_copies;
    END IF;

    IF COALESCE(v_printer.paper_monitoring_enabled, TRUE) THEN
      v_new_paper_remaining := GREATEST(0, v_printer.paper_remaining - v_sheets_to_deduct);
    END IF;

    -- Update printer paper level
    UPDATE public.printers
    SET paper_remaining = v_new_paper_remaining,
        updated_at = now()
    WHERE id = v_printer.id;

    -- Mark job paper_deducted = TRUE
    UPDATE public.print_jobs
    SET paper_deducted = TRUE
    WHERE id = p_job_id;

    -- Log paper details
    INSERT INTO public.paper_consumption_logs (
      printer_id, job_id, pages, copies, double_sided, sheets_consumed, old_remaining, new_remaining
    ) VALUES (
      v_printer.id, p_job_id, v_pages_to_print, v_copies, v_double_sided, v_sheets_to_deduct, v_old_paper_remaining, v_new_paper_remaining
    );

    v_log_msg := format('PAPER DEDUCTION: Printer ID: %s, Job ID: %s, Pages: %s, Copies: %s, Double sided: %s, Sheets consumed: %s, Old remaining: %s, New remaining: %s, Timestamp: %s',
      v_printer.id, p_job_id, v_pages_to_print, v_copies, v_double_sided, v_sheets_to_deduct, v_old_paper_remaining, v_new_paper_remaining, now());
    RAISE NOTICE '%', v_log_msg;
  END IF;

  -- Reload printer to get fresh toner levels if updated
  SELECT * INTO v_printer FROM public.printers WHERE id = v_printer.id FOR UPDATE;

  -- 4. Toner deduction block (protect from double deduction)
  IF NOT v_job.toner_deducted THEN
    v_toner_to_deduct := v_pages_to_print * v_copies;

    IF COALESCE(v_printer.toner_monitoring_enabled, TRUE) THEN
      v_new_toner_remaining := GREATEST(0, v_printer.toner_remaining - v_toner_to_deduct);
    END IF;

    -- Update printer toner level
    UPDATE public.printers
    SET toner_remaining = v_new_toner_remaining,
        updated_at = now()
    WHERE id = v_printer.id;

    -- Mark job toner_deducted = TRUE
    UPDATE public.print_jobs
    SET toner_deducted = TRUE
    WHERE id = p_job_id;

    -- Log toner details
    INSERT INTO public.toner_consumption_logs (
      printer_id, job_id, pages, copies, toner_consumed, old_remaining, new_remaining
    ) VALUES (
      v_printer.id, p_job_id, v_pages_to_print, v_copies, v_toner_to_deduct, v_old_toner_remaining, v_new_toner_remaining
    );

    v_log_msg := format('TONER DEDUCTION: Printer ID: %s, Job ID: %s, Pages: %s, Copies: %s, Toner consumed: %s, Old remaining: %s, New remaining: %s, Timestamp: %s',
      v_printer.id, p_job_id, v_pages_to_print, v_copies, v_toner_to_deduct, v_old_toner_remaining, v_new_toner_remaining, now());
    RAISE NOTICE '%', v_log_msg;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'job_id', p_job_id,
    'paper_consumed', CASE WHEN NOT v_job.paper_deducted THEN v_sheets_to_deduct ELSE 0 END,
    'toner_consumed', CASE WHEN NOT v_job.toner_deducted THEN v_toner_to_deduct ELSE 0 END,
    'new_paper_remaining', v_new_paper_remaining,
    'new_toner_remaining', v_new_toner_remaining
  );
END;
$$;

-- Grant permissions for RPC
GRANT EXECUTE ON FUNCTION public.complete_print_job(uuid, uuid, integer, numeric, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_print_job(uuid, uuid, integer, numeric, uuid, uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.complete_print_job(uuid, uuid, integer, numeric, uuid, uuid, text) TO service_role;
