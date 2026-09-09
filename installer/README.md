# Windows Installer

SmartPrinter Desktop ships as a single NSIS-based installer (via `electron-builder`,
configured in `apps/desktop-ui/electron-builder.yml`) that installs BOTH halves of the
application:

1. The Electron UI (into `%ProgramFiles%\SmartPrinter Desktop` by default).
2. The `SmartPrinter.Agent` Windows Service, via the custom install hooks in
   `nsis-service-hooks.nsh` (macros `customInstall` / `customUnInstall`).

## Why NSIS instead of MSIX/WiX

The blueprint asked to "prefer MSIX if practical, otherwise NSIS/WiX." MSIX is the more
modern choice, but its packaging model complicates registering a Windows Service and
running `sc.exe` during install (MSIX apps are more sandboxed than traditional
installers). NSIS - which is what `electron-builder`'s default Windows target already
uses - gives us a straightforward `customInstall` hook to run `sc.exe create` and
`icacls`, which is exactly what installing a companion Windows Service needs. If you
later want MSIX for Microsoft Store distribution or stricter enterprise deployment
policies, a WiX-based MSIX wrapper around the same two binaries is the natural next step,
but it is not included here - budget real time for it, it is a non-trivial rewrite of
this installer.

## Build the installer

```powershell
cd services/desktop-agent/SmartPrinter.Agent
dotnet publish -c Release -r win-x64 --self-contained false -o ../../../apps/desktop-ui/agent-publish

cd ../../../apps/desktop-ui
# Copy the published agent into the folder electron-builder will bundle as "agent/"
# (adjust electron-builder.yml `files` / `extraResources` to include it - see comment
# in nsis-service-hooks.nsh).
npm run package
```

The resulting installer is written to `dist-packages/` at the repo root.

## Code signing

Without a code-signing certificate, Windows SmartScreen will show an "Unknown
Publisher" warning on first run, which will scare off non-technical shop owners - this
is one of the highest-risk parts of the rollout plan (see docs/DEPLOYMENT.md "highest
risk decisions").

1. Obtain an EV (Extended Validation) code-signing certificate from a CA (DigiCert,
   Sectigo, etc.) - EV certificates get SmartScreen reputation much faster than
   standard OV certificates.
2. Set the following environment variables before running `npm run package`:
   - `CSC_LINK` - path or URL to the `.pfx` file.
   - `CSC_KEY_PASSWORD` - the certificate's password.
3. `electron-builder` signs the installer and the app executable automatically when
   these are present - see `apps/desktop-ui/electron-builder.yml`.
4. The `SmartPrinter.Agent.exe` binary should ALSO be signed with the same certificate
   before being copied into the installer's `agent/` folder - unsigned Windows Service
   binaries can trigger separate warnings/Defender scrutiny. Add a `signtool sign` step
   to your publish pipeline (see `.github/workflows/release.yml`).

## Upgrade behavior

NSIS (`perMachine: true` in electron-builder.yml) upgrades in place: running a newer
installer over an existing installation stops the old service, replaces the binaries,
and starts the new service - this is handled by the `customInstall` macro's
stop/delete/recreate sequence, so no separate "upgrade" code path is needed.

## Uninstall behavior

- The Electron app and its shortcuts are removed normally by NSIS.
- The Windows Service is stopped and deleted (`customUnInstall`).
- Local data (`%ProgramData%\SmartPrinter\Agent` - the DPAPI-encrypted device credential,
  SQLite queue, and logs) is **preserved** by default, so a shop owner who reinstalls
  does not have to re-pair. Use `scripts/uninstall-service.ps1 -RemoveData` for a full
  wipe when retiring a machine.
