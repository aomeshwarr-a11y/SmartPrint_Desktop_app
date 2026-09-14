# Supabase Setup (Development/Staging)

**Do this against a NEW, separate Supabase project - never your production SmartPrinter
project.** This repo's migrations are proposed schema, not a verified match to your real
production tables (see the assumption flag at the top of
`supabase/migrations/0001_init.sql`).

## 1. Create a project

Create a new project at [supabase.com](https://supabase.com) (or run Supabase locally
with the Supabase CLI, `supabase start`, if you prefer a fully local dev loop).

## 2. Apply migrations

Using the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase login
supabase link --project-ref your-project-ref
supabase db push
```

This applies, in order:

1. `migrations/0001_init.sql` - core schema.
2. `migrations/0002_rls_policies.sql` - Row Level Security policies.
3. `migrations/0003_device_pairing_requests.sql` - pairing support table.

## 3. Create the Storage bucket

```bash
supabase storage buckets create print-files --private
```

(Or via the dashboard: Storage -> New bucket -> name `print-files`.)

## 4. Deploy Edge Functions

```bash
supabase functions deploy device-pairing-create
supabase functions deploy device-pairing-confirm
supabase functions deploy device-token-refresh
supabase functions deploy device-revoke
supabase functions deploy signed-url-generate
supabase functions deploy print-job-status-update
supabase functions deploy razorpay-webhook
```

## 5. Set Edge Function secrets

```bash
supabase secrets set SUPABASE_JWT_SECRET=<Project Settings > API > JWT Settings>
supabase secrets set RAZORPAY_WEBHOOK_SECRET=<from Razorpay dashboard>
supabase secrets set RAZORPAY_KEY_ID=<from Razorpay dashboard>
supabase secrets set RAZORPAY_KEY_SECRET=<from Razorpay dashboard>
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by Supabase for
every Edge Function - do not set them yourself.

## 6. Configure the Razorpay webhook

In the Razorpay dashboard, add a webhook pointing at:

```
https://your-project-ref.supabase.co/functions/v1/razorpay-webhook
```

Subscribe to at least: `payment.captured`, `payment.failed`, `subscription.activated`,
`subscription.charged`, `refund.processed`. Use the same secret you set as
`RAZORPAY_WEBHOOK_SECRET` above.

## 7. Get your anon key and URL for the apps

Project Settings -> API -> `Project URL` and `anon public` key. Put these into:

- `apps/desktop-ui/.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
- `services/desktop-agent/SmartPrinter.Agent/appsettings.Development.json` (or the
  equivalent `SMARTPRINTER_Supabase__*` environment variables)

## 8. Seed a test shop (optional, for manual E2E testing)

Sign up through the Electron UI's Signup screen, then complete Shop Setup - this creates
your `shops` row via the normal app flow rather than hand-inserting test data, which is
the more realistic path for catching RLS issues early.

## Reconciling with your real production schema

Since your actual SmartPrinter production database already has `shops` / `branches` /
`printers` / `print_jobs` concepts (per the original prompt), the next step for a "second
pass" is to diff `supabase/migrations/0001_init.sql` and `0002_rls_policies.sql` against
your real schema and adjust column names/types in both the SQL and the corresponding C#
models (`Cloud/CloudModels.cs`) and Edge Functions to match exactly. This repo's schema
is a complete, internally-consistent reference to diff against - it is not a drop-in
replacement for tables that already contain real production data.
