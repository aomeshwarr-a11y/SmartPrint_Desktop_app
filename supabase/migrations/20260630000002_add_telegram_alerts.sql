-- Migration to add Telegram alerts configuration and tracking

-- 1. Add Telegram settings to branches table
ALTER TABLE public.branches 
ADD COLUMN IF NOT EXISTS telegram_alerts_enabled BOOLEAN DEFAULT false NOT NULL,
ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT,
ADD COLUMN IF NOT EXISTS in_charge_name TEXT,
ADD COLUMN IF NOT EXISTS primary_phone TEXT,
ADD COLUMN IF NOT EXISTS secondary_phone TEXT;

-- 2. Add alert state tracking to printers table
ALTER TABLE public.printers
ADD COLUMN IF NOT EXISTS paper_alert_state TEXT DEFAULT 'none' NOT NULL,
ADD COLUMN IF NOT EXISTS toner_alert_state TEXT DEFAULT 'none' NOT NULL;

-- 3. Create app_settings table to store configuration
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Insert local webhook default URL
INSERT INTO public.app_settings (key, value)
VALUES ('telegram_alert_url', 'http://localhost:54321/functions/v1/send-telegram-alert')
ON CONFLICT (key) DO NOTHING;

-- 4. Create telegram_alerts_queue table
CREATE TABLE IF NOT EXISTS public.telegram_alerts_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  printer_id UUID NOT NULL REFERENCES public.printers(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL, -- 'paper' or 'toner'
  alert_level TEXT NOT NULL, -- 'low', 'critical', 'out'
  value INTEGER NOT NULL,
  sent BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.telegram_alerts_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view telegram alerts queue" ON public.telegram_alerts_queue FOR SELECT USING (true);
CREATE POLICY "Anyone can manage telegram alerts queue" ON public.telegram_alerts_queue FOR ALL USING (true);

-- 5. Create trigger to check consumables and transition alert states
CREATE OR REPLACE FUNCTION public.check_consumables_alerts()
RETURNS TRIGGER AS $$
DECLARE
  v_telegram_enabled BOOLEAN;
  v_new_paper_state TEXT;
  v_new_toner_state TEXT;
BEGIN
  -- Get branch details to check if alerts are enabled
  IF NEW.branch_id IS NOT NULL THEN
    SELECT telegram_alerts_enabled INTO v_telegram_enabled 
    FROM public.branches WHERE id = NEW.branch_id;
  END IF;
  
  v_telegram_enabled := COALESCE(v_telegram_enabled, FALSE);

  -- Detect Refill/Replace and Reset Alert States (if levels increase)
  IF OLD IS NOT NULL AND NEW.paper_remaining > OLD.paper_remaining THEN
    NEW.paper_alert_state := 'none';
  END IF;
  IF OLD IS NOT NULL AND NEW.toner_remaining > OLD.toner_remaining THEN
    NEW.toner_alert_state := 'none';
  END IF;

  -- Determine new paper state
  v_new_paper_state := NEW.paper_alert_state;
  IF COALESCE(NEW.paper_monitoring_enabled, TRUE) THEN
    IF NEW.paper_remaining <= 0 THEN
      v_new_paper_state := 'out';
    ELSIF NEW.paper_remaining <= COALESCE(NEW.critical_paper_threshold, 10) THEN
      v_new_paper_state := 'critical';
    ELSIF NEW.paper_remaining <= COALESCE(NEW.low_paper_threshold, 50) THEN
      v_new_paper_state := 'low';
    ELSE
      v_new_paper_state := 'none';
    END IF;
  ELSE
    v_new_paper_state := 'none';
  END IF;

  -- Determine new toner state
  v_new_toner_state := NEW.toner_alert_state;
  IF COALESCE(NEW.toner_monitoring_enabled, TRUE) THEN
    IF NEW.toner_remaining <= 0 THEN
      v_new_toner_state := 'out';
    ELSIF NEW.toner_remaining <= COALESCE(NEW.critical_toner_threshold, 50) THEN
      v_new_toner_state := 'critical';
    ELSIF NEW.toner_remaining <= COALESCE(NEW.low_toner_threshold, 300) THEN
      v_new_toner_state := 'low';
    ELSE
      v_new_toner_state := 'none';
    END IF;
  ELSE
    v_new_toner_state := 'none';
  END IF;

  -- Trigger Paper Alerts on Transition (if moving to a new worse state)
  IF v_new_paper_state != COALESCE(NEW.paper_alert_state, 'none') AND v_new_paper_state != 'none' THEN
    NEW.paper_alert_state := v_new_paper_state;
    IF v_telegram_enabled THEN
      INSERT INTO public.telegram_alerts_queue (printer_id, alert_type, alert_level, value)
      VALUES (NEW.id, 'paper', v_new_paper_state, NEW.paper_remaining);
    END IF;
  END IF;

  -- Trigger Toner Alerts on Transition
  IF v_new_toner_state != COALESCE(NEW.toner_alert_state, 'none') AND v_new_toner_state != 'none' THEN
    NEW.toner_alert_state := v_new_toner_state;
    IF v_telegram_enabled THEN
      INSERT INTO public.telegram_alerts_queue (printer_id, alert_type, alert_level, value)
      VALUES (NEW.id, 'toner', v_new_toner_state, NEW.toner_remaining);
    END IF;
  END IF;

  -- Sync state changes back if we transitioned to 'none' (refill recovery)
  IF v_new_paper_state = 'none' THEN
    NEW.paper_alert_state := 'none';
  END IF;
  IF v_new_toner_state = 'none' THEN
    NEW.toner_alert_state := 'none';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_check_consumables_alerts ON public.printers;
CREATE TRIGGER trg_check_consumables_alerts
  BEFORE UPDATE OF paper_remaining, toner_remaining, paper_monitoring_enabled, toner_monitoring_enabled ON public.printers
  FOR EACH ROW
  EXECUTE FUNCTION public.check_consumables_alerts();

-- 6. Trigger to asynchronously call Edge Function when alert is queued
CREATE OR REPLACE FUNCTION public.trg_process_telegram_alert()
RETURNS TRIGGER AS $$
DECLARE
  v_url TEXT;
BEGIN
  -- Get the webhook URL from app_settings
  SELECT value INTO v_url FROM public.app_settings WHERE key = 'telegram_alert_url';
  IF v_url IS NULL OR v_url = '' THEN
    v_url := 'http://localhost:54321/functions/v1/send-telegram-alert';
  END IF;

  -- Call Edge Function asynchronously
  PERFORM net.http_post(
    url := v_url,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := json_build_object(
      'alert_id', NEW.id,
      'printer_id', NEW.printer_id,
      'alert_type', NEW.alert_type,
      'alert_level', NEW.alert_level,
      'value', NEW.value
    )::text
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_process_telegram_alert ON public.telegram_alerts_queue;
CREATE TRIGGER trg_process_telegram_alert
  AFTER INSERT ON public.telegram_alerts_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_process_telegram_alert();
