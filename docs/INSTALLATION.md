# Installation Guide

There are two audiences for this document: a **developer** building the installer, and
a **shop owner** running it. Both are covered below.

## For developers: building the installer

See [installer/README.md](../installer/README.md) for the full build chain
(`dotnet publish` the agent, then `npm run package` in `apps/desktop-ui`, which produces
a single NSIS installer under `dist-packages/`).

Quick version:

```powershell
cd services\desktop-agent\SmartPrinter.Agent
dotnet publish -c Release -r win-x64 --self-contained false -o ..\..\..\apps\desktop-ui\agent-publish

cd ..\..\..\apps\desktop-ui
npm run package
```

The output installer is `dist-packages\SmartPrinter Desktop Setup <version>.exe`.

## For shop owners: installing on the shop PC

1. Download `SmartPrinter Desktop Setup.exe` from the link SmartPrinter sends you (or
   from smartprinter.in/download once published).
2. Run the installer. Windows may show a SmartScreen prompt the first time a new
   publisher's app is run - see [SECURITY.md](./SECURITY.md) for what this means and how
   it's mitigated with code signing.
3. The installer will:
   - Install the SmartPrinter Desktop app (Start Menu + Desktop shortcut).
   - Install and start the SmartPrinter background service automatically - you do not
     need to do anything else for this part.
4. Launch **SmartPrinter Desktop** from the Start Menu.
5. **Create an account or log in.**
6. **Shop setup** - enter your shop's name and address.
7. **Subscription** - choose a plan and complete payment.
8. **Pair this computer** - click "Generate pairing code", then confirm it in the app.
9. **Printer discovery** - SmartPrinter will list the printers already installed on this
   computer (make sure your printer's Windows driver is installed and the printer is
   plugged in and turned on first).
10. **Authorize printers** - turn on the printer(s) you want customers to be able to use.
11. **QR code** - print this and place it somewhere visible in your shop.

That's it - the background service keeps running and printing jobs even if you close
the SmartPrinter Desktop window, restart the computer, or aren't logged in.

## Uninstalling

Use Windows' normal "Add or remove programs" and remove "SmartPrinter Desktop". This
also stops and removes the background service. Your pairing/device credential is kept
on disk in case you reinstall - see [installer/README.md](../installer/README.md) for
how to wipe it completely if you're retiring the computer.

## Verifying the install worked

Open **Printer Status** in the app and click **Print test page** next to your printer -
a page should come out within a few seconds. If it doesn't, see
[TROUBLESHOOTING.md](./TROUBLESHOOTING.md).
