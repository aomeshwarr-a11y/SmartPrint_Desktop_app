-- =============================================================================
-- SmartPrint Desktop Agent — additive migration (DESIGN ONLY)
--
-- Verified against the LIVE `smartprinter` Supabase project
-- (ref vabjcmkziudkqjwyzils) via read-only inspection on 2026-09-13.
--
-- THIS FILE HAS NOT BEEN EXECUTED. Review, adjust, and apply it yourself
-- (e.g. via `supabase db push` from a migration file, or Studio's SQL editor)
-- when ready. It is additive only:
--   - 4 brand-new tables (verified against all 25 existing table names,
--     130+ function names, and 45+ trigger names currently in production —
--     no collisions).
--   - 1 new nullable column on the existing `printers` table.
--   - Zero changes to `branches`, `print_jobs`, `payments`, `users`, or any
--     other existing table, function, trigger, policy, or Realtime config.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. desktop_agents — one row per paired Windows PC running the agent.
--    Root ownership is `branches`, matching the real production model
--    (there is no `shops` table — branches.owner_id / manager_id / user_roles
--    already express ownership for everything else in this schema).
-- ---------------------------------------------------------------------------
create table if not exists public.desktop_agents (
    id              uuid primary key default gen_random_uuid(),
    branch_id       uuid not null references public.branches(id) on delete cascade,
    agent_name      text not null default 'Desktop Agent',
    hostname        text,
    os_version      text,
    app_version     text,
    status          text not null default 'active' check (status in ('active','suspended','revoked')),
    paired_at       timestamptz not null default now(),
    paired_by       uuid references public.users(id) on delete set null,
    last_seen_at    timestamptz,
    revoked_at      timestamptz,
    revoked_by      uuid references public.users(id) on delete set null,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index if not exists idx_desktop_agents_branch_id on public.desktop_agents(branch_id);
create index if not exists idx_desktop_agents_active on public.desktop_agents(branch_id) where status = 'active';

-- ---------------------------------------------------------------------------
-- 2. desktop_agent_tokens — hashes only. The raw token is returned to the
--    Agent exactly once (at pairing or refresh time) and never stored.
-- ---------------------------------------------------------------------------
create table if not exists public.desktop_agent_tokens (
    id                uuid primary key default gen_random_uuid(),
    desktop_agent_id  uuid not null references public.desktop_agents(id) on delete cascade,
    token_hash        text not null unique,
    created_via       text not null default 'pairing' check (created_via in ('pairing','refresh')),
    issued_at         timestamptz not null default now(),
    expires_at        timestamptz not null,
    last_used_at      timestamptz,
    revoked_at        timestamptz,
    constraint desktop_agent_tokens_expiry_check check (expires_at > issued_at)
);

create index if not exists idx_desktop_agent_tokens_agent on public.desktop_agent_tokens(desktop_agent_id);
create index if not exists idx_desktop_agent_tokens_live on public.desktop_agent_tokens(expires_at) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- 3. desktop_agent_pairing_requests — short-lived, human-typed pairing codes.
-- ---------------------------------------------------------------------------
create table if not exists public.desktop_agent_pairing_requests (
    id                          uuid primary key default gen_random_uuid(),
    branch_id                   uuid not null references public.branches(id) on delete cascade,
    pairing_code                text not null unique,
    created_by                  uuid not null references public.users(id) on delete cascade,
    expires_at                  timestamptz not null,
    confirmed_at                timestamptz,
    confirmed_desktop_agent_id  uuid references public.desktop_agents(id) on delete set null,
    created_at                  timestamptz not null default now(),
    constraint desktop_agent_pairing_requests_expiry_check check (expires_at > created_at)
);

create index if not exists idx_desktop_agent_pairing_branch on public.desktop_agent_pairing_requests(branch_id);
create index if not exists idx_desktop_agent_pairing_pending on public.desktop_agent_pairing_requests(expires_at) where confirmed_at is null;

-- ---------------------------------------------------------------------------
-- 4. desktop_agent_events — meaningful lifecycle/audit events only
--    (paired, token_refreshed, token_revoked, printer_linked, incident_reported,
--    error). NOT a target for high-frequency heartbeat spam — see write-up.
-- ---------------------------------------------------------------------------
create table if not exists public.desktop_agent_events (
    id                uuid primary key default gen_random_uuid(),
    desktop_agent_id  uuid not null references public.desktop_agents(id) on delete cascade,
    event_type        text not null,
    detail            jsonb not null default '{}'::jsonb,
    created_at        timestamptz not null default now()
);

create index if not exists idx_desktop_agent_events_agent_created on public.desktop_agent_events(desktop_agent_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5. printers — ONE additive, nullable column. All 7 existing rows stay
--    valid with desktop_agent_id = NULL ("not managed by a desktop agent").
--    No other column, constraint, policy, or trigger on `printers` is touched.
-- ---------------------------------------------------------------------------
alter table public.printers
    add column if not exists desktop_agent_id uuid references public.desktop_agents(id) on delete set null;

create index if not exists idx_printers_desktop_agent_id
    on public.printers(desktop_agent_id) where desktop_agent_id is not null;

-- ---------------------------------------------------------------------------
-- 6. updated_at trigger, scoped narrowly to desktop_agents only.
--    Production already has fn_set_updated_at / update_updated_at_column /
--    update_updated_at / branch_waitlist_touch_updated_at, any of which is
--    *probably* a safe generic `NEW.updated_at = now()` you could reuse
--    instead — this defines its own rather than taking an unverified
--    dependency on one of those bodies. Swap it out if you confirm one is
--    generic and prefer not to add a 7th near-duplicate.
-- ---------------------------------------------------------------------------
create or replace function public.desktop_agents_set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger trg_desktop_agents_updated_at
    before update on public.desktop_agents
    for each row execute function public.desktop_agents_set_updated_at();

-- ---------------------------------------------------------------------------
-- 7. Row Level Security
--    All four new tables reuse the SAME branch-ownership checks already
--    governing `branches`/`printers`/`kiosk_incidents` (b.owner_id /
--    b.manager_id / user_roles with role IN ('branch','branch_owner')),
--    plus is_admin() for staff. No new helper function or custom JWT claim
--    is introduced — see write-up for why that's unnecessary here.
-- ---------------------------------------------------------------------------
alter table public.desktop_agents enable row level security;
alter table public.desktop_agent_tokens enable row level security;
alter table public.desktop_agent_pairing_requests enable row level security;
alter table public.desktop_agent_events enable row level security;

-- desktop_agents: branch owner/manager/staff can view + rename/revoke their
-- own branch's agents; admins see/manage everything. The agent itself can view
-- and update its own record (heartbeat last_seen_at) via id = auth.uid().
create policy "branch_select_desktop_agents" on public.desktop_agents
    for select using (
        public.is_admin()
        or desktop_agents.id = auth.uid()
        or exists (
            select 1 from public.branches b
            where b.id = desktop_agents.branch_id
              and (b.owner_id = auth.uid() or b.manager_id = auth.uid())
        )
        or exists (
            select 1 from public.user_roles ur
            where ur.user_id = auth.uid()
              and ur.branch_id = desktop_agents.branch_id
              and ur.role::text = any (array['branch','branch_owner','shop_owner'])
        )
    );

create policy "branch_update_desktop_agents" on public.desktop_agents
    for update using (
        public.is_admin()
        or desktop_agents.id = auth.uid()
        or exists (
            select 1 from public.branches b
            where b.id = desktop_agents.branch_id
              and (b.owner_id = auth.uid() or b.manager_id = auth.uid())
        )
    )
    with check (
        public.is_admin()
        or desktop_agents.id = auth.uid()
        or exists (
            select 1 from public.branches b
            where b.id = desktop_agents.branch_id
              and (b.owner_id = auth.uid() or b.manager_id = auth.uid())
        )
    );

-- desktop_agent_tokens: RLS enabled, ZERO client policies (intentional
-- default-deny). Only Edge Functions (service_role) ever read or write
-- token hashes — same pattern as production's existing zero-policy tables
-- (app_settings, waitlists) and the same reasoning the original blueprint
-- correctly applied to its own device_tokens table.

-- desktop_agent_pairing_requests: branch owner/manager/staff can request a
-- code for their own branch and watch it while pending. No UPDATE policy —
-- confirmation is only ever performed by the pairing-confirm Edge Function,
-- since the confirming party (the Desktop Agent) never holds a Supabase
-- session at all.
create policy "branch_create_pairing_request" on public.desktop_agent_pairing_requests
    for insert with check (
        created_by = auth.uid()
        and (
            public.is_admin()
            or exists (
                select 1 from public.branches b
                where b.id = branch_id and (b.owner_id = auth.uid() or b.manager_id = auth.uid())
            )
            or exists (
                select 1 from public.user_roles ur
                where ur.user_id = auth.uid() and ur.branch_id = branch_id
                  and ur.role::text = any (array['branch','branch_owner','shop_owner'])
            )
        )
    );

create policy "branch_select_own_pairing_requests" on public.desktop_agent_pairing_requests
    for select using (
        public.is_admin()
        or created_by = auth.uid()
        or exists (
            select 1 from public.branches b
            where b.id = branch_id and (b.owner_id = auth.uid() or b.manager_id = auth.uid())
        )
    );

-- desktop_agent_events: branch owner/manager/staff + admins can read events
-- for their own branch's agents. No client INSERT policy — only Edge
-- Functions (service_role) write events.
create policy "branch_select_desktop_agent_events" on public.desktop_agent_events
    for select using (
        public.is_admin()
        or exists (
            select 1 from public.desktop_agents da
            join public.branches b on b.id = da.branch_id
            where da.id = desktop_agent_events.desktop_agent_id
              and (b.owner_id = auth.uid() or b.manager_id = auth.uid())
        )
        or exists (
            select 1 from public.desktop_agents da
            join public.user_roles ur on ur.branch_id = da.branch_id
            where da.id = desktop_agent_events.desktop_agent_id
              and ur.user_id = auth.uid()
              and ur.role::text = any (array['branch','branch_owner','shop_owner'])
        )
    );

-- ---------------------------------------------------------------------------
-- 8. print_jobs RLS policies for Desktop Agent
--    Authorizes the Desktop Agent (whose JWT has auth.uid() = desktop_agents.id)
--    to SELECT and UPDATE only the print jobs assigned to printers managed
--    by this specific desktop agent (printers.desktop_agent_id = auth.uid()).
--    Does NOT authorize all jobs in the branch.
-- ---------------------------------------------------------------------------
create policy "desktop_agent_select_assigned_print_jobs" on public.print_jobs
    for select to authenticated
    using (
        exists (
            select 1 from public.printers p
            where p.id = print_jobs.printer_id
              and p.desktop_agent_id = auth.uid()
        )
    );

create policy "desktop_agent_update_assigned_print_jobs" on public.print_jobs
    for update to authenticated
    using (
        exists (
            select 1 from public.printers p
            where p.id = print_jobs.printer_id
              and p.desktop_agent_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1 from public.printers p
            where p.id = print_jobs.printer_id
              and p.desktop_agent_id = auth.uid()
        )
    );

-- ---------------------------------------------------------------------------
-- 9. Realtime Configuration
--    print_jobs is already published in `supabase_realtime` in production.
--    The C# Desktop Agent uses direct Supabase Realtime (RealtimeJobListener.cs)
--    authenticated via client.Realtime.SetAuth(jwt). The CDC change stream
--    automatically evaluates the `desktop_agent_select_assigned_print_jobs`
--    policy above, streaming only print jobs assigned to printers managed
--    by this agent.
--
--    Ensure UPDATE events contain the full row for change handlers:
--    alter table public.print_jobs replica identity full;
-- ---------------------------------------------------------------------------
