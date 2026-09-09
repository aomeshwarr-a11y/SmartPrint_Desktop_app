# SmartPrinter Windows Desktop Automation

Full source code for turning a print shop's existing Windows PC + printer into a
SmartPrinter-controlled kiosk, per `SmartPrinter_Windows_Automation_Blueprint.md`. Built
as: **Electron + React + TypeScript** desktop UI, a **C#/.NET 8 Windows Service**
background printing agent, **SQLite** local durable queue, and **Supabase**
(Postgres + Auth + Storage + Realtime + Edge Functions) for the cloud side.

**Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first** - it maps every blueprint
section to the actual code and is honest about the handful of places this
implementation simplified or deviated from the original spec.

## Repository layout

```
apps/desktop-ui/         Electron + React + TypeScript desktop UI
services/desktop-agent/   C#/.NET 8 Windows Service background agent
packages/shared-contracts/ Shared TypeScript IPC/domain types
supabase/                  Migrations + Edge Functions
scripts/                   PowerShell operational scripts (install/start/stop/logs)
installer/                 NSIS installer config + service-install hooks
docs/                      Full documentation set (see below)
.github/workflows/         CI + release pipelines
```

## Quick start (development)

```powershell
git clone <this-repo> smartprinter-desktop
cd smartprinter-desktop
npm install
copy .env.example apps\desktop-ui\.env   # fill in Supabase values, or leave as-is for MockCloudMode

# Terminal 1 - background agent (console mode, no service install needed)
cd services\desktop-agent\SmartPrinter.Agent
dotnet restore
dotnet run -- --console

# Terminal 2 - Electron UI
cd ..\..\..
npm run dev:electron
```

Full instructions: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Documentation

| Doc | Covers |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Blueprint-to-code mapping, deviations, honest limitations |
| [docs/INSTALLATION.md](docs/INSTALLATION.md) | Building the installer; shop-owner install steps |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Full local dev setup, mock mode, common issues |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production build/sign/release, highest-risk decisions |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Symptom -> cause -> fix, manual hardware checklist pointer |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, what's implemented vs. flagged as a gap |
| [docs/WINDOWS-PRINTERS.md](docs/WINDOWS-PRINTERS.md) | Printer engine internals, PDFium dependency, spooler honesty notes |
| [docs/SUPABASE-SETUP.md](docs/SUPABASE-SETUP.md) | Standing up a dev/staging Supabase project |
| [docs/RELEASE.md](docs/RELEASE.md) | Release checklist |

## First end-to-end test

1. Start the agent (`dotnet run -- --console`, `MockCloudMode: true` by default).
2. Start the Electron UI (`npm run dev:electron`).
3. Open **Printer Status** - your Windows-installed printers should appear within a
   couple of seconds.
4. Click **Print test page** next to one of them.
5. A physical page (or a PDF, if you're using "Microsoft Print to PDF") should be
   produced within a few seconds, with the outcome logged in the agent's console output.

This exercises the real Win32 printer discovery -> submission -> spooler monitoring path
end to end without needing any Supabase credentials at all - see
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for how to also exercise the full
cloud-job-delivery path once you have a dev Supabase project set up.

## What is fully implemented vs. what needs your input

**Fully implemented, real code (no pseudocode/TODOs):**
- Win32 printer discovery, capability detection, job submission, and spooler monitoring.
- In-process PDF rendering and printing (no visible viewer window).
- SQLite local durable queue with idempotency and crash recovery.
- DPAPI-encrypted device credential storage.
- Secure named-pipe IPC between Electron and the C# service.
- Supabase Realtime-based job delivery with reconnect/backoff and catch-up queries.
- Full device pairing flow (create/confirm/refresh/revoke) as Edge Functions.
- Razorpay webhook signature verification (the only trusted payment-success path).
- All 18 required Electron UI screens, wired to real IPC/Supabase calls.
- Database schema + RLS policies for the full data model.
- xUnit test suite for the C# agent's core logic.

**Needs your input before this runs against real production data:**
- Reconcile `supabase/migrations/` against your actual production schema (flagged
  throughout as an assumption) - see docs/ARCHITECTURE.md.
- Verify the exact NuGet package versions for `supabase-csharp` and
  `PdfiumViewer`/`PdfiumViewer.Native.*` resolve cleanly with `dotnet restore` in your
  environment - version availability can drift over time; see
  docs/WINDOWS-PRINTERS.md.
- Obtain and wire in a real EV code-signing certificate before any shop pilot (see
  docs/DEPLOYMENT.md "highest risk decisions").
- Decide self-contained vs. framework-dependent .NET publish for the agent (see
  docs/DEPLOYMENT.md).
- Application-level rate limiting on public Edge Functions is not implemented (flagged
  in docs/SECURITY.md).

## Known limitations (please read before relying on this)

This entire codebase was generated in a sandboxed Linux environment with no Windows
machine, no .NET SDK, no Electron display, and no real Supabase/Razorpay credentials
available to actually compile, run, or test against. Concretely:

- **Nothing here has been compiled.** `dotnet build`/`dotnet test` for the C# project
  and `npm run build`/`electron-builder` for the desktop app have not been run. The code
  follows correct, idiomatic patterns for each API used, but the very first thing to do
  on a real Windows machine is run `dotnet restore && dotnet build` and
  `npm install && npm run typecheck`, and fix whatever surface-level compile errors turn
  up (a missing `using`, a slightly-off API signature, a NuGet version that's since
  moved) - treat this as a thorough first draft that needs a real build pass, not
  finished, verified software.
- **No physical printer, real Supabase project, or real Razorpay account** was available
  to exercise this against - the manual hardware test checklist and first end-to-end
  test above are the intended path to actually proving it works, and you should expect
  to spend real debugging time there.
- The `supabase-csharp` and `PdfiumViewer` package APIs were used from general
  knowledge of their public surface, not verified against a pinned, currently-published
  version - see docs/WINDOWS-PRINTERS.md for the specific fallback if PdfiumViewer
  doesn't resolve as pinned.

None of this changes the architecture or the security model - it means budget real
"make it actually compile and run" time before a shop pilot, the same as you would for
any large first implementation pass.
