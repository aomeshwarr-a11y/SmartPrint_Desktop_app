-- Migration to add consumables management to printers table

-- 1. Add columns to printers table if they don't exist
ALTER TABLE public.printers ADD COLUMN IF NOT EXISTS paper_capacity INTEGER NOT NULL DEFAULT 500;
ALTER TABLE public.printers ADD COLUMN IF NOT EXISTS paper_remaining INTEGER NOT NULL DEFAULT 500;
ALTER TABLE public.printers ADD COLUMN IF NOT EXISTS last_refill_date TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.printers ADD COLUMN IF NOT EXISTS last_refilled_by TEXT;
ALTER TABLE public.printers ADD COLUMN IF NOT EXISTS paper_monitoring_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.printers ADD COLUMN IF NOT EXISTS low_paper_threshold INTEGER NOT NULL DEFAULT 50;
ALTER TABLE public.printers ADD COLUMN IF NOT EXISTS critical_paper_threshold INTEGER NOT NULL DEFAULT 10;
ALTER TABLE public.printers ADD COLUMN IF NOT EXISTS auto_pause_on_no_paper BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.printers ADD COLUMN IF NOT EXISTS toner_capacity INTEGER NOT NULL DEFAULT 3000;
ALTER TABLE public.printers ADD COLUMN IF NOT EXISTS toner_remaining INTEGER NOT NULL DEFAULT 3000;
ALTER TABLE public.printers ADD COLUMN IF NOT EXISTS last_toner_replace_date TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.printers ADD COLUMN IF NOT EXISTS last_toner_replaced_by TEXT;
ALTER TABLE public.printers ADD COLUMN IF NOT EXISTS toner_monitoring_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.printers ADD COLUMN IF NOT EXISTS low_toner_threshold INTEGER NOT NULL DEFAULT 300;
ALTER TABLE public.printers ADD COLUMN IF NOT EXISTS critical_toner_threshold INTEGER NOT NULL DEFAULT 50;
ALTER TABLE public.printers ADD COLUMN IF NOT EXISTS auto_pause_on_no_toner BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. Create function to handle consumables decrement on job completion
CREATE OR REPLACE FUNCTION public.handle_consumables_on_job_completion()
RETURNS TRIGGER AS $$
DECLARE
  v_pages_printed INTEGER;
  v_sheets_printed INTEGER;
  v_printer RECORD;
  v_new_paper INTEGER;
  v_new_toner INTEGER;
BEGIN
  -- Only trigger when job becomes 'done' or 'completed'
  IF (NEW.status IN ('done', 'completed')) AND (OLD.status IS NULL OR OLD.status NOT IN ('done', 'completed')) THEN
    
    -- Fetch printer details
    SELECT * INTO v_printer FROM public.printers WHERE id = NEW.printer_id;
    IF NOT FOUND THEN
      RETURN NEW;
    END IF;

    -- Calculate sheets and pages printed
    v_pages_printed := COALESCE(NEW.pages_to_print, NEW.total_pages, 1) * COALESCE(NEW.copies, 1);
    IF COALESCE(NEW.double_sided, FALSE) THEN
      v_sheets_printed := CEIL(COALESCE(NEW.pages_to_print, NEW.total_pages, 1)::NUMERIC / 2.0) * COALESCE(NEW.copies, 1);
    ELSE
      v_sheets_printed := v_pages_printed;
    END IF;

    v_new_paper := v_printer.paper_remaining;
    v_new_toner := v_printer.toner_remaining;

    -- Deduct paper if enabled
    IF v_printer.paper_monitoring_enabled THEN
      v_new_paper := GREATEST(0, v_printer.paper_remaining - v_sheets_printed);
    END IF;

    -- Deduct toner if enabled
    IF v_printer.toner_monitoring_enabled THEN
      v_new_toner := GREATEST(0, v_printer.toner_remaining - v_pages_printed);
    END IF;

    -- Update printer with new consumables levels
    UPDATE public.printers
    SET paper_remaining = v_new_paper,
        toner_remaining = v_new_toner,
        updated_at = now()
    WHERE id = NEW.printer_id;

  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Drop existing trigger if it exists and create it
DROP TRIGGER IF EXISTS trg_handle_consumables_on_job_completion ON public.print_jobs;
CREATE TRIGGER trg_handle_consumables_on_job_completion
  AFTER UPDATE ON public.print_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_consumables_on_job_completion();
