-- Real-time Printer Status Table
CREATE TABLE IF NOT EXISTS public.printer_status (
    printer_id UUID PRIMARY KEY REFERENCES public.printers(id) ON DELETE CASCADE,
    is_online BOOLEAN NOT NULL DEFAULT false,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable Realtime for the new table
ALTER PUBLICATION supabase_realtime ADD TABLE printer_status;

-- Sync initial data from printers table
INSERT INTO public.printer_status (printer_id, is_online, last_seen)
SELECT id, (status = 'online' OR status = 'busy'), COALESCE(last_seen, now())
FROM public.printers
ON CONFLICT (printer_id) DO NOTHING;

-- Trigger to sync printer_status back to printers table (Status propagation)
-- This ensures existing logic depending on printers.status still works
CREATE OR REPLACE FUNCTION public.sync_printer_status_to_main()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.printers
    SET 
        status = CASE 
            WHEN NEW.is_online = false THEN 'offline'
            WHEN printers.status = 'busy' THEN 'busy' -- Preserve busy status if already busy
            ELSE 'online' 
        END,
        last_seen = NEW.last_seen,
        updated_at = now()
    WHERE id = NEW.printer_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_printer_status_update ON public.printer_status;
CREATE TRIGGER on_printer_status_update
    AFTER UPDATE OR INSERT ON public.printer_status
    FOR EACH ROW EXECUTE FUNCTION public.sync_printer_status_to_main();

-- RLS for printer_status
ALTER TABLE public.printer_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view printer status"
    ON public.printer_status FOR SELECT
    USING (true);

CREATE POLICY "Service role can manage status"
    ON public.printer_status FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
