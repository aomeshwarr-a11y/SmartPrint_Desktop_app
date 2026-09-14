-- Correct printer-to-branch mapping
-- Assign printers to their correct branch manually

-- Smartprinter mapping
UPDATE public.printers
SET branch_id = '80c70eec-1a27-4c0b-8683-698a9a014e94'
WHERE name = 'Smartprinter';

-- Self Service Printer (assuming this is for the other branch cccccccc-0001-4000-c000-000000000001)
UPDATE public.printers
SET branch_id = 'cccccccc-0001-4000-c000-000000000001'
WHERE name = 'Self Service Printer';
