-- Simple printer status migration
ALTER TABLE public.printers DROP CONSTRAINT IF EXISTS printers_status_check;
ALTER TABLE public.printers ADD CONSTRAINT printers_status_check CHECK (status IN ('online', 'offline', 'busy'));

-- Ensure columns exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='printers' AND column_name='last_seen') THEN
    ALTER TABLE public.printers ADD COLUMN last_seen TIMESTAMP WITH TIME ZONE;
  END IF;
END $$;

-- Update existing printers to be offline if not seen recently (Safety cleanup)
UPDATE public.printers 
SET status = 'offline' 
WHERE last_seen < now() - interval '30 seconds' OR last_seen IS NULL;
