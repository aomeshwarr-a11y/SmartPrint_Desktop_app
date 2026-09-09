# Deployment Guide

## Overview

Production deployment has three independent pieces:

1. **Supabase project** (production) - migrations, Edge Functions, secrets. See
   [SUPABASE-SETUP.md](./SUPABASE-SETUP.md), pointed at your real production project
   this time, after you've reconciled the schema (see ARCHITECTURE.md "Deviations").
2. **Windows installer** - built and code-signed, distributed to shop owners. See
   [installer/README.md](../installer/README.md).
3. **Update feed** - a static file host (S3, Supabase Storage with a public bucket, or
   any CDN) serving `latest.yml` + the installer, which `electron-updater` polls.

## Building a release

```powershell
# 1. Publish the C# agent (self-contained=false assumes shop PCs have or will get the
#    .NET 8 Runtime - see the self-contained note below for the trade-off).
cd services\desktop-agent\SmartPrinter.Agent
dotnet publish -c Release -r win-x64 --self-contained false -o ..\..\..\apps\desktop-ui\agent-publish

# 2. Sign the agent executable (requires signtool.exe from the Windows SDK and your
#    code-signing certificate).
signtool sign /f your-cert.pfx /p $env:CSC_KEY_PASSWORD /fd sha256 /tr http://timestamp.digicert.com /td sha256 ..\..\..\apps\desktop-ui\agent-publish\SmartPrinter.Agent.exe

# 3. Build and package the Electron app + installer (electron-builder signs the
#    installer/app automatically when CSC_LINK/CSC_KEY_PASSWORD are set).
cd ..\..\..\apps\desktop-ui
$env:CSC_LINK = "path-to-your-cert.pfx"
$env:CSC_KEY_PASSWORD = "your-cert-password"
npm run package
```

### Self-contained vs framework-dependent .NET publish

`--self-contained false` produces a smaller installer but requires the .NET 8 Runtime to
be present on the shop PC (Windows 10/11 does not ship it by default). Two options:

- **Framework-dependent (current default)**: smaller installer, but you must either
  bundle the .NET 8 Desktop Runtime installer alongside SmartPrinter's installer (add a
  step to `nsis-service-hooks.nsh`'s `customInstall` to silently run the runtime
  installer if not already present), or instruct shop owners to install it separately
  first (worse UX - avoid for a non-technical audience).
- **Self-contained** (`--self-contained true -p:PublishSingleFile=true`): larger
  installer (~70-100MB extra) but zero extra runtime dependency for the shop owner. For
  a "shop owner installs this themselves, no IT support" product, self-contained is the
  safer default despite the size - consider switching before general rollout.

## Release channels

electron-builder's `publish` config in `electron-builder.yml` points at
`https://updates.smartprinter.in/desktop/` (a placeholder - replace with your real
update feed URL). Maintain two channels by publishing to separate paths/buckets:

- `beta/` - your pilot shops (see the blueprint's Phase 8).
- `stable/` - general rollout.

`electron-updater` reads `latest.yml` from whichever URL you configure per build - set a
different `publish.url` for beta vs. stable builds in CI (see
`.github/workflows/release.yml`).

## Rollback

- **Electron/UI**: keep the previous version's installer + `latest.yml` available in
  your release bucket; re-point the "stable" channel's `latest.yml` at the previous
  version's files to roll back what `electron-updater` offers new/updating installs.
- **Windows Service**: the installer's `customInstall` hook always does a clean
  stop/delete/recreate of the service, so reinstalling an older installer version is a
  valid rollback path for the agent half too.

## Highest-risk engineering decisions (read before rollout)

1. **Code signing is not optional for a non-technical audience.** An unsigned installer
   triggers a scary "Windows protected your PC" SmartScreen prompt that will cause a
   meaningful fraction of shop owners to abandon installation. Budget time and money for
   an EV certificate before any real shop pilot.
2. **Physical print completion cannot be fully verified for most consumer printers**
   (see WINDOWS-PRINTERS.md). Decide your dispute-resolution process (refund policy for
   "it said printed but nothing came out") before rollout, not after the first support
   ticket.
3. **The .NET Runtime dependency** (see self-contained note above) is an easy thing to
   get wrong for a non-technical install audience - test the exact installer on a truly
   clean Windows 10/11 VM (no Visual Studio, no .NET SDK pre-installed) before shipping.
4. **RLS policy correctness** is what actually stands between "device A can only see
   shop A's jobs" and a cross-shop data leak - any schema change must be paired with a
   review of `supabase/migrations/0002_rls_policies.sql`, not just the table structure.

## Scaling notes

See the original blueprint (`SmartPrinter_Windows_Automation_Blueprint.md`) §20 for the
10 -> 10,000 shop scaling analysis - it remains accurate for this implementation since
job delivery is Realtime-connection-count-bound, not polling-request-rate-bound (see
`Cloud/RealtimeJobListener.cs`).
