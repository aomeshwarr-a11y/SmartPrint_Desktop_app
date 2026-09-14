-- Migration to fix paper consumption and duplicate deductions

-- 1. Create paper_consumption_logs table if not exists
CREATE TABLE IF NOT EXISTS public.paper_consumption_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  printer_id UUID NOT NULL REFERENCES public.printers(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.print_jobs(id) ON DELETE CASCADE,
  pages INTEGER NOT NULL,
  copies INTEGER NOT NULL,
  double_sided BOOLEAN NOT NULL,
  sheets_consumed INTEGER NOT NULL,
  old_remaining INTEGER NOT NULL,
  new_remaining INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS on the logs table
ALTER TABLE public.paper_consumption_logs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist to avoid conflict
DROP POLICY IF EXISTS "Anyone can view paper consumption logs" ON public.paper_consumption_logs;
DROP POLICY IF EXISTS "Anyone can manage paper consumption logs" ON public.paper_consumption_logs;

-- Allow select and insert for anyone (matching other tables)
CREATE POLICY "Anyone can view paper consumption logs" ON public.paper_consumption_logs FOR SELECT USING (true);
CREATE POLICY "Anyone can manage paper consumption logs" ON public.paper_consumption_logs FOR ALL USING (true);

-- 2. Add paper_deducted column to print_jobs table if it doesn't exist
ALTER TABLE public.print_jobs ADD COLUMN IF NOT EXISTS paper_deducted BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Drop the old automatic trigger that was double deducting or failing
DROP TRIGGER IF EXISTS trg_handle_consumables_on_job_completion ON public.print_jobs;

-- 3.1. Drop the Telegram alerts webhook trigger if the pgnet extension is missing or causing crashes
DROP TRIGGER IF EXISTS trg_process_telegram_alert ON public.telegram_alerts_queue;

-- 4. Update complete_print_job RPC function to transition status to 'completed' and handle paper deduction atomically
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
  v_old_remaining INTEGER;
  v_new_remaining INTEGER;
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

  -- 3. Check duplicate deduction protection using paper_deducted boolean
  IF v_job.paper_deducted THEN
    -- Fetch current levels to return accurate payload
    SELECT paper_remaining INTO v_new_remaining FROM public.printers WHERE id = COALESCE(p_printer_id, v_job.printer_id);
    RETURN jsonb_build_object(
      'success', true, 
      'message', 'Paper already deducted for this job', 
      'already_deducted', true,
      'sheets_consumed', 0,
      'old_remaining', v_new_remaining,
      'new_remaining', v_new_remaining
    );
  END IF;

  -- 4. Fetch the printer and lock it
  SELECT * INTO v_printer FROM public.printers WHERE id = COALESCE(p_printer_id, v_job.printer_id) FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'message', 'Printer not found for paper deduction');
  END IF;

  v_pages_to_print := COALESCE(v_job.pages_to_print, v_job.total_pages, p_pages, 1);
  v_copies := COALESCE(v_job.copies, 1);
  v_double_sided := COALESCE(v_job.double_sided, FALSE);

  -- 5. Calculate sheets to deduct using formula
  IF v_double_sided THEN
    v_sheets_to_deduct := CEIL(v_pages_to_print::NUMERIC / 2.0) * v_copies;
  ELSE
    v_sheets_to_deduct := v_pages_to_print * v_copies;
  END IF;

  v_old_remaining := v_printer.paper_remaining;
  
  -- Deduct paper if monitoring is enabled
  IF COALESCE(v_printer.paper_monitoring_enabled, TRUE) THEN
    v_new_remaining := GREATEST(0, v_printer.paper_remaining - v_sheets_to_deduct);
  ELSE
    v_new_remaining := v_printer.paper_remaining;
  END IF;

  -- 6. Update printer levels
  UPDATE public.printers
  SET paper_remaining = v_new_remaining,
      updated_at = now()
  WHERE id = v_printer.id;

  -- 7. Mark job as paper deducted
  UPDATE public.print_jobs
  SET paper_deducted = TRUE
  WHERE id = p_job_id;

  -- 8. Log details into paper_consumption_logs table
  INSERT INTO public.paper_consumption_logs (
    printer_id, job_id, pages, copies, double_sided, sheets_consumed, old_remaining, new_remaining
  ) VALUES (
    v_printer.id, p_job_id, v_pages_to_print, v_copies, v_double_sided, v_sheets_to_deduct, v_old_remaining, v_new_remaining
  );

  -- 9. Log details to Supabase / PostgreSQL logs
  v_log_msg := format('PAPER DEDUCTION: Printer ID: %s, Job ID: %s, Pages: %s, Copies: %s, Double sided: %s, Sheets consumed: %s, Old remaining: %s, New remaining: %s, Timestamp: %s',
    v_printer.id, p_job_id, v_pages_to_print, v_copies, v_double_sided, v_sheets_to_deduct, v_old_remaining, v_new_remaining, now());
  RAISE NOTICE '%', v_log_msg;

  RETURN jsonb_build_object(
    'success', true,
    'job_id', p_job_id,
    'sheets_consumed', v_sheets_to_deduct,
    'old_remaining', v_old_remaining,
    'new_remaining', v_new_remaining,
    'already_deducted', false
  );
END;
$$;

-- Grant permissions for RPC
GRANT EXECUTE ON FUNCTION public.complete_print_job(uuid, uuid, integer, numeric, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_print_job(uuid, uuid, integer, numeric, uuid, uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.complete_print_job(uuid, uuid, integer, numeric, uuid, uuid, text) TO service_role;
