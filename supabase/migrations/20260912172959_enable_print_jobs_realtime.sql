-- Enable Postgres Changes for SmartPrint print job delivery.
alter publication supabase_realtime add table public.print_jobs;

-- Ensure UPDATE events contain the full row needed by Realtime/RLS consumers.
alter table public.print_jobs replica identity full;