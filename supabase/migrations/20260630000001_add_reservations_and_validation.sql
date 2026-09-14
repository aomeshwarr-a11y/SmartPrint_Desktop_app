-- Migration to add paper reservations and availability checks

-- 1. Create paper_reservations table
CREATE TABLE IF NOT EXISTS public.paper_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  printer_id UUID NOT NULL REFERENCES public.printers(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.print_jobs(id) ON DELETE CASCADE,
  sheets INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Enable RLS
ALTER TABLE public.paper_reservations ENABLE ROW LEVEL SECURITY;

-- Allow select and insert for anyone (matching print_jobs policies)
CREATE POLICY "Anyone can view paper reservations" ON public.paper_reservations FOR SELECT USING (true);
CREATE POLICY "Anyone can manage paper reservations" ON public.paper_reservations FOR ALL USING (true);

-- 2. Create get_available_paper function
CREATE OR REPLACE FUNCTION public.get_available_paper(p_printer_id UUID, p_exclude_job_id UUID DEFAULT NULL)
RETURNS INTEGER AS $$
DECLARE
  v_paper_remaining INTEGER;
  v_paper_monitoring BOOLEAN;
  v_reserved_pending INTEGER;
  v_reserved_paid INTEGER;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.get_available_paper(p_printer_id UUID, p_exclude_job_id UUID DEFAULT NULL)
RETURNS INTEGER AS $$
DECLARE
  v_paper_remaining INTEGER;
  v_paper_monitoring BOOLEAN;
  v_reserved_pending INTEGER;
  v_reserved_paid INTEGER;
BEGIN
  SELECT paper_remaining, paper_monitoring_enabled INTO v_paper_remaining, v_paper_monitoring
  FROM public.printers WHERE id = p_printer_id;
  
  IF NOT COALESCE(v_paper_monitoring, TRUE) THEN
    RETURN 999999; -- Return high number if monitoring is disabled
  END IF;
  
  -- Sum sheets for active reservations (for jobs that are still pending payment), excluding current job
  SELECT COALESCE(SUM(sheets), 0) INTO v_reserved_pending
  FROM public.paper_reservations r
  JOIN public.print_jobs j ON j.id = r.job_id
  WHERE r.printer_id = p_printer_id 
    AND r.expires_at > now() 
    AND j.payment_status = 'pending'
    AND (p_exclude_job_id IS NULL OR r.job_id != p_exclude_job_id);
       
  -- Sum sheets for print jobs that are paid but not yet printed/failed, excluding current job
  SELECT COALESCE(SUM(
    CASE WHEN double_sided THEN CEIL(pages_to_print::NUMERIC / 2.0) ELSE pages_to_print END * copies
  ), 0) INTO v_reserved_paid
  FROM public.print_jobs
  WHERE printer_id = p_printer_id 
    AND payment_status = 'paid' 
    AND status IN ('queued', 'printing')
    AND (p_exclude_job_id IS NULL OR id != p_exclude_job_id);

  RETURN GREATEST(0, COALESCE(v_paper_remaining, 500) - v_reserved_pending - v_reserved_paid);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Create get_available_toner function
CREATE OR REPLACE FUNCTION public.get_available_toner(p_printer_id UUID, p_exclude_job_id UUID DEFAULT NULL)
RETURNS INTEGER AS $$
DECLARE
  v_toner_remaining INTEGER;
  v_toner_monitoring BOOLEAN;
  v_reserved_paid INTEGER;
BEGIN
  SELECT toner_remaining, toner_monitoring_enabled INTO v_toner_remaining, v_toner_monitoring
  FROM public.printers WHERE id = p_printer_id;
  
  IF NOT COALESCE(v_toner_monitoring, TRUE) THEN
    RETURN 999999; -- Return high number if monitoring is disabled
  END IF;
  
  -- Sum pages for print jobs that are paid but not yet printed/failed, excluding current job
  SELECT COALESCE(SUM(pages_to_print * copies), 0) INTO v_reserved_paid
  FROM public.print_jobs
  WHERE printer_id = p_printer_id 
    AND payment_status = 'paid' 
    AND status IN ('queued', 'printing')
    AND (p_exclude_job_id IS NULL OR id != p_exclude_job_id);

  RETURN GREATEST(0, COALESCE(v_toner_remaining, 3000) - v_reserved_paid);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Create trigger function to handle paper reservation on job creation
CREATE OR REPLACE FUNCTION public.handle_paper_reservation_on_job_creation()
RETURNS TRIGGER AS $$
DECLARE
  v_sheets INTEGER;
  v_paper_monitoring BOOLEAN;
BEGIN
  SELECT paper_monitoring_enabled INTO v_paper_monitoring 
  FROM public.printers WHERE id = NEW.printer_id;
  
  IF COALESCE(v_paper_monitoring, TRUE) THEN
    -- Calculate sheets needed
    IF NEW.double_sided THEN
      v_sheets := CEIL(NEW.pages_to_print::NUMERIC / 2.0) * NEW.copies;
    ELSE
      v_sheets := NEW.pages_to_print * NEW.copies;
    END IF;
    
    -- Insert reservation (valid for 10 minutes)
    INSERT INTO public.paper_reservations (printer_id, job_id, sheets, expires_at)
    VALUES (NEW.printer_id, NEW.id, v_sheets, now() + INTERVAL '10 minutes');
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create insert trigger
DROP TRIGGER IF EXISTS trg_handle_paper_reservation_on_job_creation ON public.print_jobs;
CREATE TRIGGER trg_handle_paper_reservation_on_job_creation
  AFTER INSERT ON public.print_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_paper_reservation_on_job_creation();

-- 5. Create trigger function to release paper reservation on job update/deletion
CREATE OR REPLACE FUNCTION public.handle_paper_reservation_on_job_update()
RETURNS TRIGGER AS $$
BEGIN
  -- If payment is no longer pending, delete the reservation
  IF NEW.payment_status != 'pending' THEN
    DELETE FROM public.paper_reservations WHERE job_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create update trigger
DROP TRIGGER IF EXISTS trg_handle_paper_reservation_on_job_update ON public.print_jobs;
CREATE TRIGGER trg_handle_paper_reservation_on_job_update
  AFTER UPDATE OF payment_status ON public.print_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_paper_reservation_on_job_update();

-- Create trigger on job deletion to clean up any reservations
CREATE OR REPLACE FUNCTION public.handle_paper_reservation_on_job_deletion()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM public.paper_reservations WHERE job_id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_handle_paper_reservation_on_job_deletion ON public.print_jobs;
CREATE TRIGGER trg_handle_paper_reservation_on_job_deletion
  BEFORE DELETE ON public.print_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_paper_reservation_on_job_deletion();
