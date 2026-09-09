# Architecture (Implementation Notes)

This document is the implementation-level companion to the original
`SmartPrinter_Windows_Automation_Blueprint.md` product/architecture document. It maps
each blueprint section to the actual code, and calls out where the implementation
simplified or deviated from the blueprint and why.

## High-level flow (as implemented)

```
Customer phone --> SmartPrinter web (not in this repo) --> Razorpay --> razorpay-webhook
    (Edge Function, verifies signature) --> print_jobs row created in Supabase
        --> RealtimeJobListener (C# agent, subscribed by device_id)
            --> JobProcessor.HandleAssignedJobAsync
                --> SqliteQueueRepository.TryEnqueueJobAsync (idempotent)
                --> SupabaseGateway.DownloadFromSignedUrlAsync (via signed-url-generate)
                --> WindowsPrinterService.SubmitDocumentAsync (PdfiumPrintEngine renders pages)
                --> WindowsPrinterService.WatchSpoolerJobAsync
                --> SupabaseGateway.UpdatePrintJobStatusAsync
                    --> Electron UI (polls agent via named pipe) shows live status
```

## Where this repo's code lives, by blueprint section

| Blueprint section | Implementation |
|---|---|
| §3 Desktop app design (UI vs background service split) | `apps/desktop-ui` (Electron/React) is the UI; `services/desktop-agent` (C# Windows Service) is the background half. They communicate only over the named pipe (`electron/pipeClient.ts` <-> `Ipc/NamedPipeServer.cs`). |
| §4 Tech stack | Electron + React/TS for UI, C#/.NET 8 Worker Service for the agent - see `docs/DEVELOPMENT.md` and the original blueprint §4 for the comparison table that led here. |
| §5 Windows printing engine | `Printing/WindowsPrinterService.cs` (Win32 P/Invoke via `NativeMethods.cs`) + `Printing/PdfiumPrintEngine.cs`. |
| §6/§16 Cloud/database architecture | `supabase/migrations/0001_init.sql` (schema), `Cloud/CloudModels.cs` (C# side mapping). |
| §7 Supabase security / RLS | `supabase/migrations/0002_rls_policies.sql`, `docs/SECURITY.md`. |
| §8 Device pairing | `Cloud/DeviceAuthService.cs`, `supabase/functions/device-pairing-create`, `device-pairing-confirm`, `device-token-refresh`, `device-revoke`. |
| §9 QR system | `apps/desktop-ui/src/pages/QrCode.tsx` (renders `smartprinter.in/s/<slug>` only - no secrets). |
| §10 Payment architecture | `supabase/functions/razorpay-webhook/index.ts` (server-side verification only). |
| §11 Real-time job delivery | `Cloud/RealtimeJobListener.cs` (Supabase Realtime, reconnect/backoff, catch-up query - NOT polling). |
| §12 Local queue | `Data/SqliteQueueRepository.cs`, schema in `Data/Migrations/001_initial.sql`. |
| §13 Failure scenarios | `Cloud/JobProcessor.cs` (`HandleFailureAsync`, `RecoverAsync`). |
| §14 Observability | `Logging/SerilogConfig.cs`, `HealthCheck/LastSeenUpdater.cs`, Diagnostics screen + `ExportDiagnosticsAsync`. |
| §15 Deployment/updates | `apps/desktop-ui/electron-builder.yml`, `installer/`, `.github/workflows/release.yml`. |
| §21 Threat model | `docs/SECURITY.md`. |

## Deviations from the original blueprint (and why)

1. **One device = one shop PC, printers keyed by `device_id`.** The blueprint allows a
   shop to expose multiple printers through one agent - this is implemented (the
   `printers` table has its own id, keyed to a `device_id`), but the `razorpay-webhook`'s
   job-creation logic in this reference implementation picks the first authorized
   printer for the shop as a **simplification** rather than implementing full
   printer-selection-at-checkout logic (which belongs in the customer-facing web app,
   not in this repo). Flagged in a code comment at the relevant line.
2. **`print-job-status-update` Edge Function vs. direct table update.** The blueprint's
   RLS design alone (`device can update status of its own print jobs`) is sufficient for
   the agent to update status directly via Postgrest. This repo adds an Edge Function
   with an explicit state-machine transition table
   (`supabase/functions/print-job-status-update`) as the RECOMMENDED path for production,
   since it rejects illegal transitions (e.g. `queued` -> `completed` without ever
   downloading) that a raw RLS-gated UPDATE cannot express. `SupabaseGateway.cs` in this
   repo currently uses the direct-table-update path for simplicity/offline-tolerance;
   switching it to call the Edge Function instead is a small, well-contained change if
   you want the stricter validation in production.
3. **MSIX vs NSIS installer.** The blueprint said "prefer MSIX if practical." NSIS was
   used instead because it lets the installer register a Windows Service via a simple
   `customInstall` hook (`sc.exe create`) - see `installer/README.md` for the full
   reasoning and the path to an MSIX wrapper later if needed.
4. **PDF options fidelity.** Copies, duplex, and paper size are set via
   `System.Drawing.Printing.PrinterSettings`/`PageSettings`, which the vast majority of
   Windows drivers honor - but per the blueprint's own honesty requirement (§5), not
   every consumer printer/driver combination supports every option, and the code
   degrades gracefully (falls back to driver defaults, logs a warning) rather than
   failing the whole job.

## Honest limitation carried over from the blueprint

The Windows Print Spooler can confirm a job was **accepted and left the queue** - it
generally cannot confirm the physical page was produced correctly for printers that
don't report that back to their own driver. `WindowsPrinterService.WatchSpoolerJobAsync`
implements the most honest signal available (spooler status polling via `GetJob`), and
the Printer Status screen's "Print test page" button exists specifically so a shop owner
can visually confirm end-to-end connectivity rather than relying on software-only
confirmation for disputed cases.
