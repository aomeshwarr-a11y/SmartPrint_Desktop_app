-- Migration: Fix Telegram alert dispatch (pg_net not available)
-- The trg_process_telegram_alert trigger previously called net.http_post()
-- which requires the pg_net extension. Since pg_net is not enabled in this
-- Supabase project, the trigger caused transaction rollbacks on every
-- paper/toner update.
--
-- Fix: Drop the crashing trigger. The Pi Agent now handles alert dispatching
-- via a background thread that polls telegram_alerts_queue every 10 seconds
-- and calls the deployed send-telegram-alert Edge Function directly.
--
-- The check_consumables_alerts trigger still runs on printers table updates
-- and correctly inserts rows into telegram_alerts_queue. The Pi Agent thread
-- then picks those rows up and dispatches them.

-- Drop the pg_net-dependent trigger that was crashing transactions
DROP TRIGGER IF EXISTS trg_process_telegram_alert ON public.telegram_alerts_queue;
DROP FUNCTION IF EXISTS public.trg_process_telegram_alert();

-- Keep the check_consumables_alerts trigger intact (inserts queue rows correctly)
-- It is defined in 20260630000002_add_telegram_alerts.sql

-- Fix the app_settings URL to point to production (already correct, but ensure it stays)
INSERT INTO public.app_settings (key, value)
VALUES ('telegram_alert_url', 'https://vabjcmkziudkqjwyzils.supabase.co/functions/v1/send-telegram-alert')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Add a settings key documenting the dispatch method
INSERT INTO public.app_settings (key, value)
VALUES ('telegram_dispatch_method', 'pi_agent_polling')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
