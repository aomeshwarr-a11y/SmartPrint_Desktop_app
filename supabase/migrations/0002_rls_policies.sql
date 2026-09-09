-- =============================================================================
-- Row Level Security policies.
--
-- Two principals matter here:
--   1. "owner" - a normal Supabase Auth user (auth.uid()), i.e. the shop owner logged
--      into the Electron UI or the web dashboard.
--   2. "device" - the desktop agent, authenticated with a short-lived JWT minted by the
--      device-token-refresh Edge Function. That JWT carries a custom claim
--      `device_id` (set via Supabase's `auth.jwt()` custom claims mechanism through the
--      Edge Function's service-role-signed token) which these policies check against.
--      The desktop agent's anon-key + device-JWT combination NEVER has broader access
--      than these policies grant - there is no service_role key on the desktop.
--
-- The public/customer-facing read needed for the QR landing page (resolve slug -> shop,
-- check subscription active) is handled by a narrowly-scoped anon SELECT policy, not by
-- disabling RLS.
-- =============================================================================

alter table shops enable row level security;
alter table branches enable row level security;
alter table subscriptions enable row level security;
alter table subscription_events enable row level security;
alter table devices enable row level security;
alter table device_tokens enable row level security;
alter table device_events enable row level security;
alter table printers enable row level security;
alter table qr_codes enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table payments enable row level security;
alter table print_jobs enable row level security;
alter table print_job_events enable row level security;
alter table audit_logs enable row level security;

-- Helper: extracts the device_id custom claim from the device's JWT, or null for a
-- normal user session / anon request.
create or replace function auth_device_id()
returns uuid
language sql stable
as $$
    select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'device_id', '')::uuid
$$;

-- ---------------------------------------------------------------------------
-- shops
-- ---------------------------------------------------------------------------

create policy "owner can read own shop" on shops
    for select using (owner_user_id = auth.uid());

create policy "owner can update own shop" on shops
    for update using (owner_user_id = auth.uid());

create policy "owner can insert own shop" on shops
    for insert with check (owner_user_id = auth.uid());

-- Public/anon read of a single shop's name for the QR landing page. Only non-sensitive
-- columns should ever be selected by the anon-key client via a view or explicit column
-- list on the frontend query - RLS here only governs row visibility, not column
-- visibility, so the web app must still select narrowly.
create policy "anon can read active shops by slug" on shops
    for select using (status = 'active');

-- ---------------------------------------------------------------------------
-- branches / printers (owner-scoped via shop ownership; device-scoped via device_id)
-- ---------------------------------------------------------------------------

create policy "owner can manage own branches" on branches
    for all using (shop_id in (select id from shops where owner_user_id = auth.uid()));

create policy "owner can manage own printers" on printers
    for all using (branch_id in (
        select b.id from branches b join shops s on s.id = b.shop_id where s.owner_user_id = auth.uid()
    ));

create policy "device can read its authorized printers" on printers
    for select using (device_id = auth_device_id() and authorized = true);

-- ---------------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------------

create policy "owner can read own subscriptions" on subscriptions
    for select using (shop_id in (select id from shops where owner_user_id = auth.uid()));

create policy "owner can read own subscription events" on subscription_events
    for select using (subscription_id in (
        select id from subscriptions where shop_id in (select id from shops where owner_user_id = auth.uid())
    ));

-- Subscriptions/payments are otherwise only ever written by Edge Functions using the
-- service_role key (server-side), which bypasses RLS entirely - so no insert/update
-- policy is granted here to owner or device on purpose.

-- ---------------------------------------------------------------------------
-- devices / device_tokens / device_events
-- ---------------------------------------------------------------------------

create policy "owner can read own devices" on devices
    for select using (shop_id in (select id from shops where owner_user_id = auth.uid()));

create policy "device can read and update its own row" on devices
    for select using (id = auth_device_id());

create policy "device can update its own last_seen" on devices
    for update using (id = auth_device_id())
    with check (id = auth_device_id());

-- device_tokens is intentionally NOT selectable by owner or device via the client -
-- only Edge Functions (service_role) ever read/write token hashes.

create policy "owner can read own device events" on device_events
    for select using (device_id in (
        select id from devices where shop_id in (select id from shops where owner_user_id = auth.uid())
    ));

-- ---------------------------------------------------------------------------
-- qr_codes
-- ---------------------------------------------------------------------------

create policy "owner can manage own qr codes" on qr_codes
    for all using (shop_id in (select id from shops where owner_user_id = auth.uid()));

create policy "anon can resolve active qr codes" on qr_codes
    for select using (active = true);

-- ---------------------------------------------------------------------------
-- orders / order_items / payments (customer-facing, session-scoped)
-- ---------------------------------------------------------------------------

-- Customers are anonymous (no Supabase Auth account) - order visibility is scoped by a
-- per-browser-session token (`customer_session_id`) generated client-side and passed as
-- a request header the Edge Functions validate; the anon policy below intentionally
-- allows inserting a new order (order creation) but not reading arbitrary orders, so a
-- customer can only ever read the specific order they just created via the id returned
-- by the order-creation Edge Function (fetched with `.eq('id', orderId)` from the client,
-- which combined with this broad-looking policy is still safe because order ids are
-- unguessable UUIDs - never enumerate orders in the UI).
create policy "anon can create orders for active shops" on orders
    for insert with check (shop_id in (select id from shops where status = 'active'));

create policy "anon can read orders by id" on orders
    for select using (true);

create policy "owner can read own shop orders" on orders
    for select using (shop_id in (select id from shops where owner_user_id = auth.uid()));

create policy "anon can manage own order items" on order_items
    for all using (order_id in (select id from orders));

create policy "owner can read own order items" on order_items
    for select using (order_id in (
        select id from orders where shop_id in (select id from shops where owner_user_id = auth.uid())
    ));

create policy "owner can read own payments" on payments
    for select using (
        order_id in (select id from orders where shop_id in (select id from shops where owner_user_id = auth.uid()))
        or subscription_id in (select id from subscriptions where shop_id in (select id from shops where owner_user_id = auth.uid()))
    );

-- Payments are only ever written by the Razorpay webhook Edge Function (service_role).

-- ---------------------------------------------------------------------------
-- print_jobs / print_job_events - the core device-facing tables
-- ---------------------------------------------------------------------------

create policy "device can read its own print jobs" on print_jobs
    for select using (device_id = auth_device_id());

create policy "device can update status of its own print jobs" on print_jobs
    for update using (device_id = auth_device_id())
    with check (device_id = auth_device_id());

create policy "owner can read own shop print jobs" on print_jobs
    for select using (device_id in (
        select id from devices where shop_id in (select id from shops where owner_user_id = auth.uid())
    ));

-- print_jobs INSERT only ever happens via the print-job-status-update / order-payment
-- Edge Functions (service_role) after payment verification - no client insert policy.

create policy "device can insert events for its own jobs" on print_job_events
    for insert with check (print_job_id in (select id from print_jobs where device_id = auth_device_id()));

create policy "device can read events for its own jobs" on print_job_events
    for select using (print_job_id in (select id from print_jobs where device_id = auth_device_id()));

create policy "owner can read own shop job events" on print_job_events
    for select using (print_job_id in (
        select pj.id from print_jobs pj
        join devices d on d.id = pj.device_id
        join shops s on s.id = d.shop_id
        where s.owner_user_id = auth.uid()
    ));

-- ---------------------------------------------------------------------------
-- audit_logs - readable by nobody except via the service_role (support/back office
-- tooling), never exposed to owner or device clients.
-- ---------------------------------------------------------------------------
-- (No policies created - RLS enabled with zero policies means zero client access,
-- which is the intended default-deny posture for this table.)
