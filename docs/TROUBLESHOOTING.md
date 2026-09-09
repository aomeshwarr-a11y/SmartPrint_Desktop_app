# Troubleshooting

## The Electron UI says "Can't reach the SmartPrinter background service"

1. Check the Windows Service is running: `Get-Service SmartPrinterAgent` (should show
   `Running`). If not: `.\scripts\start-service.ps1`.
2. Check the pipe name matches between `services/desktop-agent/SmartPrinter.Agent/appsettings.json`
   (`Agent:PipeName`) and `apps/desktop-ui/electron/pipeClient.ts` (`PIPE_NAME`) - both
   default to `SmartPrinterAgentPipe`.
3. Check the agent's log file for a startup error: `.\scripts\view-logs.ps1`.
4. If you're in development (`--console` mode), make sure that process is still running
   in its terminal window.

## Printer doesn't show up in Printer Discovery

1. Confirm the printer shows up in Windows' own "Printers & scanners" settings first -
   if Windows doesn't see it, SmartPrinter won't either (see WINDOWS-PRINTERS.md - the
   agent only enumerates what `EnumPrinters` returns).
2. Click Refresh on the Printer Discovery screen - the agent only re-scans on demand,
   not continuously.
3. Restart the SmartPrinter service after installing a new printer driver.

## "Print test page" doesn't produce a page

1. Check the printer isn't paused or set offline in Windows.
2. Check paper and ink/toner.
3. Check the agent's log for the specific spooler error (`.\scripts\view-logs.ps1`) -
   `WindowsPrinterService` logs the Win32 error code on `EnumPrinters`/`OpenPrinter`
   failures, and any spooler-reported job error on `WatchSpoolerJobAsync` failures.
4. Try printing a normal document from Notepad to the same printer - if that also fails,
   the issue is the Windows driver/printer, not SmartPrinter.

## A job is stuck in "downloading" or "printing" in Active Jobs

1. Check internet connectivity on the shop PC - `JobProcessor` will retry downloads a
   limited number of times (`Agent:JobRetryLimit`) before marking the job failed.
2. Restart the service - `JobProcessor.RecoverAsync` re-verifies any in-flight job
   against the spooler/cloud on startup rather than leaving it stuck.
3. Check Job History for the specific error message recorded on the job.

## Device pairing fails or times out

1. Pairing codes expire after 10 minutes (`PAIRING_CODE_EXPIRY_MINUTES` in
   `supabase/functions/device-pairing-create/index.ts`) - generate a new one if it's
   been longer than that.
2. Check the owner is actually logged in (pairing requires a valid Supabase Auth
   session token, forwarded from the Electron UI to the agent to the Edge Function).
3. Check the Edge Function logs in the Supabase dashboard (Functions -> Logs) for the
   specific rejection reason.

## Payment succeeded but no print job appeared

This should be structurally impossible per the payment trust boundary (see
SECURITY.md), but if it happens in testing:

1. Check the Razorpay webhook actually fired and reached
   `razorpay-webhook` - Razorpay's dashboard shows delivery attempts and response codes
   per webhook event.
2. Check the webhook signature verification didn't reject it (function logs will show
   "signature mismatch" if so) - confirm `RAZORPAY_WEBHOOK_SECRET` matches exactly what's
   configured in the Razorpay dashboard.
3. Check that an authorized printer/device exists for the shop - `handlePaymentCaptured`
   in the webhook function logs a warning and skips job creation if none is found.

## Manual Hardware Test Checklist

See [WINDOWS-PRINTERS.md](./WINDOWS-PRINTERS.md#manual-hardware-test-checklist) for the
full checklist - this is the physical-printer validation the automated test suite
cannot perform on its own.

## Getting more detail

- Agent logs: `%ProgramData%\SmartPrinter\Agent\logs\agent-*.log` (or `.\.data\logs` in
  console dev mode).
- In-app: Diagnostics screen -> "Export diagnostic bundle" produces a zip with recent
  logs, service status, printer list, and recent job history in one file, suitable for
  attaching to a support request.
