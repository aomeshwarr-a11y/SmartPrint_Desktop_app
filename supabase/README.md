# Supabase Backend

See [../docs/SUPABASE-SETUP.md](../docs/SUPABASE-SETUP.md) for the full setup guide.

## Structure

- `migrations/0001_init.sql` - core schema (shops, branches, subscriptions, devices,
  printers, orders, print_jobs, audit_logs, etc). **Assumption-flagged** - see the
  comment at the top of the file; reconcile against your real production schema before
  using this anywhere near production data.
- `migrations/0002_rls_policies.sql` - Row Level Security policies scoping owner access
  by `auth.uid()` and device access by a custom `device_id` JWT claim.
- `migrations/0003_device_pairing_requests.sql` - supports the pairing flow.
- `functions/` - Edge Functions (Deno). Each has its own `index.ts` with a comment block
  explaining its role, required secrets, and security reasoning.

## Do not run against production

These migrations are meant to be applied to a **fresh development or staging** Supabase
project only. Do not run `supabase db push` against your production SmartPrinter project
without first diffing this schema against your real one - see
`docs/ARCHITECTURE.md` "Deviations from the original blueprint".
