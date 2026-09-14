-- SQL Script to test Telegram alerts, duplicate suppression, and recovery triggers

-- 1. Create a mock branch and printer for testing alerts
INSERT INTO public.branches (
  id, name, owner_id, telegram_alerts_enabled, telegram_chat_id, in_charge_name, primary_phone
) VALUES (
  '22222222-2222-2222-2222-222222222222',
  'Alert Test Branch',
  'c0a80101-c0a8-0101-c0a8-0101c0a80101', -- placeholder owner UUID
  true,
  '-100123456789', -- mock telegram chat id
  'John Alert',
  '+919999999999'
) ON CONFLICT (id) DO UPDATE SET
  telegram_alerts_enabled = true,
  telegram_chat_id = '-100123456789';

INSERT INTO public.printers (
  id, name, location, status, price_per_page, branch_id,
  paper_capacity, paper_remaining, paper_monitoring_enabled, low_paper_threshold, critical_paper_threshold,
  toner_capacity, toner_remaining, toner_monitoring_enabled, low_toner_threshold, critical_toner_threshold
) VALUES (
  '33333333-3333-3333-3333-333333333333',
  'Alert Test Printer',
  'Front Desk',
  'online',
  2.0,
  '22222222-2222-2222-2222-222222222222',
  100, 100, true, 50, 15,
  3000, 3000, true, 300, 50
) ON CONFLICT (id) DO UPDATE SET
  paper_remaining = 100,
  paper_alert_state = 'none',
  toner_remaining = 3000,
  toner_alert_state = 'none';

-- Verify initial alert states (should show 'none' for both paper & toner)
SELECT id, name, paper_remaining, paper_alert_state, toner_remaining, toner_alert_state
FROM public.printers WHERE id = '33333333-3333-3333-3333-333333333333';

-- 2. Trigger first alert level: Paper level drops to 40 (Low Paper threshold is 50)
UPDATE public.printers 
SET paper_remaining = 40 
WHERE id = '33333333-3333-3333-3333-333333333333';

-- Check printers (alert state should have transitioned to 'low')
SELECT paper_remaining, paper_alert_state FROM public.printers WHERE id = '33333333-3333-3333-3333-333333333333';

-- Check alerts queue (should show 1 pending alert for low paper)
SELECT * FROM public.telegram_alerts_queue WHERE printer_id = '33333333-3333-3333-3333-333333333333';

-- 3. Verify duplicate prevention: Drop paper level further to 35 (still low)
UPDATE public.printers 
SET paper_remaining = 35 
WHERE id = '33333333-3333-3333-3333-333333333333';

-- Check alerts queue (should STILL show only 1 alert total; duplicate low paper is suppressed!)
SELECT * FROM public.telegram_alerts_queue WHERE printer_id = '33333333-3333-3333-3333-333333333333';

-- 4. Trigger second level: Paper level drops to 10 (Critical Paper threshold is 15)
UPDATE public.printers 
SET paper_remaining = 10 
WHERE id = '33333333-3333-3333-3333-333333333333';

-- Check printers (alert state should be 'critical')
SELECT paper_remaining, paper_alert_state FROM public.printers WHERE id = '33333333-3333-3333-3333-333333333333';

-- Check alerts queue (should show a second alert created for 'critical' paper)
SELECT * FROM public.telegram_alerts_queue WHERE printer_id = '33333333-3333-3333-3333-333333333333';

-- 5. Test Auto Recovery: Refill paper back to 100
UPDATE public.printers 
SET paper_remaining = 100 
WHERE id = '33333333-3333-3333-3333-333333333333';

-- Check printers (alert state should have reset to 'none')
SELECT paper_remaining, paper_alert_state FROM public.printers WHERE id = '33333333-3333-3333-3333-333333333333';

-- Clean up test records
DELETE FROM public.telegram_alerts_queue WHERE printer_id = '33333333-3333-3333-3333-333333333333';
DELETE FROM public.printers WHERE id = '33333333-3333-3333-3333-333333333333';
DELETE FROM public.branches WHERE id = '22222222-2222-2222-2222-222222222222';
