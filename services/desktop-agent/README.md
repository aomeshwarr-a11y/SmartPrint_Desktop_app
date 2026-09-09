# SmartPrinter.Agent (Windows Background Service)

This is the C#/.NET 8 background agent described in the architecture blueprint. It is the
only part of the system that talks to the Windows print spooler, and it runs completely
independently of the Electron UI.

## Requirements

- Windows 10/11 (the project targets `net8.0-windows` and will not build on Linux/macOS).
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0).

## Build

```powershell
cd services/desktop-agent
dotnet restore
dotnet build
```

## Run in development (console mode, no service install required)

```powershell
cd services/desktop-agent/SmartPrinter.Agent
dotnet run -- --console
```

This runs the exact same `Worker` background service as production, just hosted as a
plain console process instead of a Windows Service - use this for day-to-day debugging.
See `appsettings.Development.json` (`MockCloudMode: true`) to exercise the printing
pipeline without real Supabase credentials - see `../../docs/DEVELOPMENT.md`.

## Run tests

```powershell
cd services/desktop-agent
dotnet test
```

Note: `DpapiProtectorTests` and any real Win32 printer spooler behavior can only be fully
exercised on Windows - see `docs/TROUBLESHOOTING.md` for the manual hardware test
checklist that complements the automated suite.

## Install as a Windows Service (production)

See `../../scripts/install-service.ps1` and `../../docs/DEPLOYMENT.md`.

## Project layout

- `Printing/` - `IPrinterService` abstraction, the real `WindowsPrinterService` (Win32
  P/Invoke via `NativeMethods`), and the PDF rendering engine (`PdfiumPrintEngine`).
- `Data/` - SQLite-backed local durable queue (`SqliteQueueRepository`) and its schema
  (`Data/Migrations/001_initial.sql`).
- `Security/` - DPAPI credential protection (`DpapiCredentialProtector`) and the on-disk
  `CredentialStore`.
- `Cloud/` - Supabase integration: `SupabaseGateway` (REST/Storage), `DeviceAuthService`
  (pairing flow), `RealtimeJobListener` (push-based job delivery), `JobProcessor`
  (end-to-end job orchestration).
- `Ipc/` - the secure named-pipe server and command router the Electron UI talks to.
- `HealthCheck/` - the low-frequency last-seen updater (explicitly not a heartbeat loop).
