# Development Guide

This covers running the full stack locally on a Windows 10/11 machine. The C# agent
targets `net8.0-windows` and uses Win32 printer APIs, DPAPI, and Windows Services - none
of that runs on Linux/macOS, so Windows is required for anything beyond editing
TypeScript.

## Prerequisites

- Windows 10/11
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
- [Node.js 18.18+](https://nodejs.org/) and npm
- A Supabase project (a free-tier dev/staging project is fine) - see
  [SUPABASE-SETUP.md](./SUPABASE-SETUP.md). You can also run everything in
  **MockCloudMode** (see below) without any Supabase project at all, to exercise the
  local printing pipeline in isolation.
- At least one printer installed in Windows (any printer - a cheap inkjet is fine, or
  Microsoft's "Microsoft Print to PDF" virtual printer works for a smoke test that
  doesn't consume paper).

## 1. Clone and install

```powershell
git clone <your-fork-url> smartprinter-desktop
cd smartprinter-desktop
npm install
```

## 2. Configure environment variables

```powershell
copy .env.example apps\desktop-ui\.env
```

Edit `apps\desktop-ui\.env` with your Supabase project's URL and anon key (or leave the
placeholder values if you're only testing MockCloudMode - the UI's Supabase-backed
screens like Login/Shop Setup won't work without real values, but printer
discovery/printing will).

## 3. Run the C# agent in console mode (no service install needed)
 "C:\Program Files\dotnet\dotnet.exe" --version  
  $env:Path += ";C:\Program Files\dotnet"   
  dotnet clean  
   dotnet restore 
   
```powershell
cd services\desktop-agent\SmartPrinter.Agent
dotnet restore
dotnet run -- --console
```

By default `appsettings.Development.json` sets `Agent:MockCloudMode = true`, which
disables Supabase Realtime job delivery but leaves printer discovery, the named pipe
server, and the printing pipeline fully real. You'll see a log line confirming mock mode
is active.

To test against a real Supabase project instead, either edit
`appsettings.Development.json` directly or set environment variables:

```powershell
$env:SMARTPRINTER_Agent__MockCloudMode = "false"
$env:SMARTPRINTER_Supabase__Url = "https://your-project-ref.supabase.co"
$env:SMARTPRINTER_Supabase__AnonKey = "your-anon-key"
dotnet run -- --console
```

## 4. Run the Electron UI

In a second terminal:

```powershell
npm run dev:electron
```

This starts the Vite dev server and an Electron window pointed at it, with hot reload
for the renderer. The main/preload processes are compiled once at startup by
`electron-builder`'s dev tooling via `tsc`; if you edit `electron/main.ts` or
`electron/preload.ts`, restart `npm run dev:electron`.

The Electron UI will try to connect to the agent's named pipe
(`\\.\pipe\SmartPrinterAgentPipe`) immediately - make sure step 3's console process is
already running first.

## 5. Exercise the printing pipeline without real Supabase credentials

With `MockCloudMode: true`, there is no Realtime job delivery, so you need another way to
get a job into the local queue:

- **Easiest:** open the Electron UI's **Printer Status** screen and click **Print test
  page** next to any discovered printer. This calls the real `IPrinterService` end to
  end (a hand-built minimal PDF is generated and sent straight to the spooler) without
  touching Supabase at all - this is the fastest way to prove the Win32 printing path
  works on your machine.
- **To exercise the full queue/state-machine path** (download → print → status update),
  insert a row directly into the local SQLite database
  (`%ProgramData%\SmartPrinter\Agent\agent.db` in production, or `.\.data\agent.db`
  relative to the agent's working directory in `--console` dev mode) with a `storage_path`
  pointing at a real file your dev Supabase Storage bucket serves, then restart the agent
  - `JobProcessor.RecoverAsync` will pick up any non-terminal job on startup.

## 6. Run tests

```powershell
cd services\desktop-agent
dotnet test
```

```powershell
cd apps\desktop-ui
npm run typecheck
```

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for the manual hardware test checklist
that the automated suite intentionally does not cover (real Win32 printer behavior needs
a real printer).

## Project-wide npm scripts (from the repo root)

```powershell
npm run dev           # Vite dev server only (browser preview of the React UI, no Electron/IPC)
npm run dev:electron  # Full Electron + Vite dev loop
npm run build          # Production build of shared-contracts + desktop-ui
npm run typecheck      # TypeScript project references across all workspaces
```

## Common issues

| Symptom | Likely cause |
|---|---|
| Electron UI shows "Can't reach the SmartPrinter background service" | The C# agent isn't running, or the named pipe name doesn't match (`Agent:PipeName` in appsettings.json vs `PIPE_NAME` in `electron/pipeClient.ts`). |
| `dotnet build` fails immediately | You're not on Windows, or the .NET 8 SDK isn't installed. The project intentionally targets `net8.0-windows`. |
| PdfiumViewer throws on load | The native `pdfium.dll` from `PdfiumViewer.Native.x86_64.v8-xfa` didn't get copied to the output directory - run a clean `dotnet restore` + `dotnet build`, and confirm the package restored correctly for your exact NuGet feed/version (see WINDOWS-PRINTERS.md). |
| Nothing prints from "Print test page" | Check the printer isn't paused/offline in Windows' own "Devices and Printers", and check the agent's log file under `%ProgramData%\SmartPrinter\Agent\logs` (or `.\.data\logs` in console mode). |
