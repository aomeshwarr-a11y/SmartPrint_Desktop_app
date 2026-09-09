-- =============================================================================
-- SmartPrinter Desktop Automation - initial schema
--
-- ASSUMPTION FLAG: table/column names here are PROPOSED, matching the architecture
-- blueprint. They have not been reconciled against your real production SmartPrinter
-- schema (shops/branches/printers/print_jobs already exist there per the prompt).
-- Treat this migration as a reference to diff against your actual schema, not as
-- something to run directly on a production project. Run it only against a fresh
-- dev/staging Supabase project. See supabase/README.md.
-- =============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- shops / branches
-- ---------------------------------------------------------------------------

create table if not exists shops (
    id uuid primary key default gen_random_uuid(),
    owner_user_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    slug text not null unique,
    status text not null default 'active' check (status in ('active', 'suspended')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (owner_user_id)
);

create table if not exists branches (
    id uuid primary key default gen_random_uuid(),
    shop_id uuid not null references shops(id) on delete cascade,
    address text,
    timezone text not null default 'Asia/Kolkata',
    created_at timestamptz not null default now()
);

create index if not exists idx_branches_shop on branches(shop_id);

-- ---------------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------------

create table if not exists subscriptions (
    id uuid primary key default gen_random_uuid(),
    shop_id uuid not null references shops(id) on delete cascade,
    plan text not null check (plan in ('monthly', 'yearly')),
    status text not null default 'pending' check (status in ('pending', 'active', 'past_due', 'cancelled')),
    razorpay_subscription_id text unique,
    current_period_end timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_subscriptions_shop on subscriptions(shop_id);

create table if not exists subscription_events (
    id uuid primary key default gen_random_uuid(),
    subscription_id uuid not null references subscriptions(id) on delete cascade,
    event_type text not null,
    raw_payload jsonb,
    created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- devices / device_tokens
-- ---------------------------------------------------------------------------

create table if not exists devices (
    id uuid primary key default gen_random_uuid(),
    shop_id uuid not null references shops(id) on delete cascade,
    name text not null default 'Shop PC',
    status text not null default 'pending' check (status in ('pending', 'active', 'revoked')),
    last_seen_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists idx_devices_shop on devices(shop_id);

-- device_tokens stores only a HASH of the device secret, never the secret itself -
-- the plaintext secret exists only transiently in the pairing-confirm response and on
-- the desktop machine's DPAPI-encrypted local store.
create table if not exists device_tokens (
    id uuid primary key default gen_random_uuid(),
    device_id uuid not null references devices(id) on delete cascade,
    token_hash text not null,
    issued_at timestamptz not null default now(),
    expires_at timestamptz,
    revoked_at timestamptz,
    unique (device_id, token_hash)
);

create index if not exists idx_device_tokens_device on device_tokens(device_id);

create table if not exists device_events (
    id uuid primary key default gen_random_uuid(),
    device_id uuid not null references devices(id) on delete cascade,
    event_type text not null,
    detail jsonb,
    created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- printers
-- ---------------------------------------------------------------------------

create table if not exists printers (
    id uuid primary key default gen_random_uuid(),
    branch_id uuid not null references branches(id) on delete cascade,
    device_id uuid references devices(id) on delete set null,
    windows_printer_name text not null,
    driver_fingerprint text,
    authorized boolean not null default false,
    status text not null default 'unknown' check (status in ('unknown', 'ready', 'offline', 'error', 'paper_jam', 'paper_out', 'busy')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_printers_branch on printers(branch_id);
create index if not exists idx_printers_device on printers(device_id);

-- ---------------------------------------------------------------------------
-- qr_codes
-- ---------------------------------------------------------------------------

create table if not exists qr_codes (
    id uuid primary key default gen_random_uuid(),
    shop_id uuid not null references shops(id) on delete cascade,
    slug text not null unique,
    active boolean not null default true,
    created_at timestamptz not null default now(),
    regenerated_at timestamptz
);

-- ---------------------------------------------------------------------------
-- orders / order_items / payments
-- ---------------------------------------------------------------------------

create table if not exists orders (
    id uuid primary key default gen_random_uuid(),
    shop_id uuid not null references shops(id) on delete cascade,
    customer_session_id text,
    status text not null default 'awaiting_payment' check (status in ('awaiting_payment', 'paid', 'failed', 'refunded')),
    total_amount numeric(10, 2) not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_orders_shop on orders(shop_id);

create table if not exists order_items (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references orders(id) on delete cascade,
    file_storage_path text not null,
    page_count integer not null check (page_count > 0),
    settings jsonb not null default '{}'::jsonb,
    price numeric(10, 2) not null,
    created_at timestamptz not null default now()
);

create index if not exists idx_order_items_order on order_items(order_id);

create table if not exists payments (
    id uuid primary key default gen_random_uuid(),
    order_id uuid references orders(id) on delete cascade,
    subscription_id uuid references subscriptions(id) on delete cascade,
    razorpay_payment_id text unique,
    razorpay_order_id text,
    status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'refunded')),
    amount numeric(10, 2),
    verified_at timestamptz,
    created_at timestamptz not null default now(),
    constraint payments_target_check check (
        (order_id is not null and subscription_id is null) or
        (order_id is null and subscription_id is not null)
    )
);

create index if not exists idx_payments_order on payments(order_id);
create index if not exists idx_payments_subscription on payments(subscription_id);

-- ---------------------------------------------------------------------------
-- print_jobs / print_job_events
-- ---------------------------------------------------------------------------

create table if not exists print_jobs (
    id uuid primary key default gen_random_uuid(),
    order_item_id uuid references order_items(id) on delete set null,
    device_id uuid not null references devices(id) on delete cascade,
    printer_id uuid not null references printers(id) on delete cascade,
    storage_path text not null,
    status text not null default 'queued' check (status in
        ('queued', 'claimed', 'downloading', 'printing', 'completed', 'failed', 'cancelled')),
    idempotency_key text not null unique,
    print_options jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_print_jobs_device_status on print_jobs(device_id, status);
create index if not exists idx_print_jobs_printer on print_jobs(printer_id);

create table if not exists print_job_events (
    id uuid primary key default gen_random_uuid(),
    print_job_id uuid not null references print_jobs(id) on delete cascade,
    event_type text not null,
    detail jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_print_job_events_job on print_job_events(print_job_id);

-- ---------------------------------------------------------------------------
-- audit_logs
-- ---------------------------------------------------------------------------

create table if not exists audit_logs (
    id uuid primary key default gen_random_uuid(),
    actor_type text not null check (actor_type in ('owner', 'device', 'system', 'support')),
    actor_id text,
    action text not null,
    target text,
    detail jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_created on audit_logs(created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

do $$
declare
    t text;
begin
    foreach t in array array['shops', 'subscriptions', 'printers', 'orders', 'print_jobs']
    loop
        execute format(
            'create trigger trg_%1$s_updated_at before update on %1$s for each row execute function set_updated_at();',
            t
        );
    end loop;
end $$;
