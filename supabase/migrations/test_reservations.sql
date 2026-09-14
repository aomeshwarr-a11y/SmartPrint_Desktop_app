-- Testing script for consumables reservation and triggers
-- Run these commands in your Supabase SQL Editor to test the logic.

-- 1. Insert a test printer
INSERT INTO public.printers (
  id, name, location, status, price_per_page, 
  paper_capacity, paper_remaining, paper_monitoring_enabled,
  toner_capacity, toner_remaining, toner_monitoring_enabled
) VALUES (
  '11111111-1111-1111-1111-111111111111', 
  'Test Reservation Printer', 
  'Test Desk', 
  'online', 
  2.0, 
  100, 100, true, 
  1000, 1000, true
) ON CONFLICT (id) DO UPDATE SET
  paper_remaining = 100,
  toner_remaining = 1000;

-- 2. Verify starting available paper (should return 100)
SELECT public.get_available_paper('11111111-1111-1111-1111-111111111111') AS initial_available;

-- 3. Create a pending print job (requires 25 pages * 1 copy = 25 sheets)
INSERT INTO public.print_jobs (
  id, printer_id, status, payment_status, pages_to_print, copies, double_sided, paper_size, color_type
) VALUES (
  '99999999-9999-9999-9999-999999999999',
  '11111111-1111-1111-1111-111111111111',
  'pending',
  'pending',
  25,
  1,
  false,
  'A4',
  'bw'
);

-- 4. Check paper reservations (should show 25 sheets reserved for our job)
SELECT * FROM public.paper_reservations 
WHERE printer_id = '11111111-1111-1111-1111-111111111111';

-- 5. Calculate available paper now (should show 75 sheets remaining)
SELECT public.get_available_paper('11111111-1111-1111-1111-111111111111') AS available_during_payment;

-- 6. Simulate payment success (payment_status -> 'paid')
UPDATE public.print_jobs 
SET payment_status = 'paid', status = 'queued' 
WHERE id = '99999999-9999-9999-9999-999999999999';

-- 7. Verify reservation was released but paper remains reserved virtually (queued/printing)
-- This should show empty reservation table but available paper should still show 75!
SELECT count(*) AS active_reservations FROM public.paper_reservations WHERE job_id = '99999999-9999-9999-9999-999999999999';
SELECT public.get_available_paper('11111111-1111-1111-1111-111111111111') AS available_while_queued;

-- 8. Simulate printing completion by the agent (status -> 'completed' or 'done')
UPDATE public.print_jobs 
SET status = 'done' 
WHERE id = '99999999-9999-9999-9999-999999999999';

-- 9. Check final status (paper_remaining in printer should be updated to 75, available_paper should remain 75)
SELECT paper_remaining FROM public.printers WHERE id = '11111111-1111-1111-1111-111111111111';
SELECT public.get_available_paper('11111111-1111-1111-1111-111111111111') AS final_available;

-- Clean up
DELETE FROM public.print_jobs WHERE id = '99999999-9999-9999-9999-999999999999';
DELETE FROM public.printers WHERE id = '11111111-1111-1111-1111-111111111111';
