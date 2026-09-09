-- Short-lived pairing requests created by device-pairing-create and consumed by
-- device-pairing-confirm. Codes are intentionally short (human-typeable) and expire
-- quickly (see EXPIRY_MINUTES in the Edge Function) - the security of the pairing flow
-- comes from requiring the OWNER to be authenticated when creating the request, not from
-- the code's length alone.

create table if not exists device_pairing_requests (
    id uuid primary key default gen_random_uuid(),
    shop_id uuid not null references shops(id) on delete cascade,
    pairing_code text not null unique,
    expires_at timestamptz not null,
    confirmed_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists idx_pairing_requests_code on device_pairing_requests(pairing_code);

alter table device_pairing_requests enable row level security;
-- No client policies - only Edge Functions (service_role) touch this table directly.
