# Windows Printer Engine Notes

## Libraries used and why

- **Win32 `winspool.drv` (via P/Invoke in `NativeMethods.cs`)** - printer enumeration
  (`EnumPrinters`), single-printer status (`GetPrinter`), capability queries
  (`DeviceCapabilities`), and spooler job monitoring/cancellation (`EnumJobs`, `GetJob`,
  `SetJob`). This is the lowest-level, most honest source of truth for what Windows
  itself knows about a printer and a job.
- **`System.Drawing.Printing.PrintDocument`** - used to actually submit rendered pages
  to the spooler. Internally, this calls the same Win32 spooler entry points; using the
  managed wrapper here (rather than hand-rolling `StartDocPrinter`/`WritePrinter`/raw
  bytes) gets you correct handling of `DEVMODE` fields (copies, duplex, color, paper
  size, orientation) via `PrinterSettings`/`PageSettings` for free, across the very wide
  range of consumer/office printer drivers already tested against this API by Microsoft
  and print vendors.
- **PdfiumViewer + PdfiumViewer.Native.x86_64.v8-xfa (NuGet)** - renders each PDF page
  to an in-memory `Bitmap` at 300 DPI, which `PrintDocument.PrintPage` then draws into
  the page bounds. PdfiumViewer wraps Google's PDFium (the same rendering engine as
  Chrome), which is why this route:
  - Never opens a visible window (a hard requirement in the original prompt).
  - Doesn't depend on whatever the shop PC's default PDF app happens to be, which
    matters both for reliability (no user configuration required) and security (a
    focused rendering library has a smaller attack surface than a full-featured PDF
    reader with forms/JS/annotation support enabled).

## Native dependency note (please verify before relying on this in production)

`PdfiumViewer.Native.x86_64.v8-xfa` ships a native `pdfium.dll`. NuGet package
availability, exact version numbers, and x64-only support can and do change over time,
and **this repo's `.csproj` package versions were written from general knowledge, not
verified against a live NuGet feed in the environment that generated this code** - run
`dotnet restore` and check for resolution errors/version conflicts as your very first
build step, and adjust the `PdfiumViewer`/`PdfiumViewer.Native.*` package references in
`SmartPrinter.Agent.csproj` if the pinned versions are no longer available. If
PdfiumViewer's native binary ever becomes hard to source, a viable alternative is
`PDFtoPrinter.exe` (a small open-source command-line tool) invoked as a child process
with `CreateNoWindow = true` - this would replace `PdfiumPrintEngine.cs` while keeping
the rest of the pipeline (`IPdfPrintEngine` interface, `JobProcessor`) unchanged.

## What the spooler can and cannot tell you (read this before promising customers
anything about "print confirmation")

- **Can tell you:** a job was accepted by the spooler, is spooling/printing, or left the
  queue (completed, deleted, or errored) - see `JOB_STATUS_*` constants in
  `NativeMethods.cs` and `WatchSpoolerJobAsync`.
- **Cannot reliably tell you, for most consumer/small-office printers:** whether the
  physical page actually came out of the tray, whether there was a paper jam mid-page,
  or whether the ink/toner ran out partway through - these require the printer's driver
  to report bidirectional status back to Windows, which many budget printers do not do
  consistently.
- **For network-capable printers**, SNMP-based polling (the approach already proven out
  for kiosk branch 6 in the SmartPrinter Raspberry Pi fleet) is a much more reliable
  physical-completion signal and is the recommended V2 addition (see
  `docs/ARCHITECTURE.md` and the original blueprint §19 "V2"). It is **not implemented**
  in this repo - `WatchSpoolerJobAsync`'s spooler-status polling is the current ceiling
  of confidence.
- **Practical fallback:** the Printer Status screen's "Print test page" button and the
  Job History / Active Jobs screens give the shop owner enough visibility to manually
  confirm or dispute a job, which is the documented fallback for V1.

## Capability detection caveats

`DeviceCapabilities(DC_DUPLEX)` and `DeviceCapabilities(DC_COLORDEVICE)` are queried per
printer during discovery (`WindowsPrinterService.QueryCapabilities`). Some drivers
report these inaccurately (e.g. a duplex-capable printer whose driver doesn't expose the
capability flag correctly) - if a shop owner reports duplex printing not working despite
their printer supporting it physically, check the driver's own properties dialog in
Windows first; this is a driver-reporting quirk outside this application's control.

## Manual hardware test checklist

Automated tests (`SmartPrinter.Agent.Tests`) exercise the printing pipeline's *logic*
against fakes/mocks - they cannot exercise real Win32 spooler behavior, since that
requires actual Windows printer drivers and hardware. Before shipping a change to
`Printing/`, manually verify on real hardware:

1. Printer discovery shows the correct name/driver/port for at least one USB and one
   network printer.
2. "Print test page" produces a physically correct page on both printer types.
3. Copies > 1 produces the correct number of physical pages.
4. Duplex toggle (if the printer supports it) actually prints double-sided.
5. Color toggle (if the printer supports it) actually changes color vs. grayscale output.
6. Unplugging the printer mid-job surfaces a failure rather than hanging indefinitely.
7. Restarting the agent process mid-print does not cause a duplicate physical page on
   the next start (see `JobProcessor.RecoverAsync`).
