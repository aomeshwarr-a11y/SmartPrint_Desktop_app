; nsis-service-hooks.nsh
;
; electron-builder's NSIS target supports a handful of named macros that get spliced
; into the generated installer/uninstaller script. We use customInstall /
; customUnInstall to also install and remove the SmartPrinter.Agent Windows Service, so
; a single installer produces both halves of the application described in
; ARCHITECTURE.md §3 (visible UI + background service).
;
; ASSUMPTION: the agent's published output (SmartPrinter.Agent.exe and its dependencies)
; has already been copied into the electron-builder "extraResources" or a sibling
; "agent" folder before packaging - see docs/DEPLOYMENT.md for the exact publish step
; this depends on. Adjust $AgentDir below to match wherever you stage it.

!macro customInstall
  DetailPrint "Installing SmartPrinter background service..."

  StrCpy $0 "$INSTDIR\agent\SmartPrinter.Agent.exe"
  StrCpy $1 "SmartPrinterAgent"

  ; Stop and remove any previous installation of the service first (upgrade scenario).
  nsExec::ExecToLog 'sc.exe stop $1'
  nsExec::ExecToLog 'sc.exe delete $1'

  nsExec::ExecToLog 'sc.exe create $1 binPath= "$0" start= auto DisplayName= "SmartPrinter Desktop Agent"'
  nsExec::ExecToLog 'sc.exe description $1 "Receives paid print jobs from SmartPrinter.in and sends them to this computer'\''s printer."'
  nsExec::ExecToLog 'sc.exe failure $1 reset= 86400 actions= restart/5000/restart/5000/restart/5000'

  CreateDirectory "$COMMONPROGRAMDATA\SmartPrinter\Agent"
  ; Restrict the data directory (DPAPI credential + local SQLite queue) to
  ; Administrators/SYSTEM only - see docs/SECURITY.md.
  nsExec::ExecToLog 'icacls "$COMMONPROGRAMDATA\SmartPrinter\Agent" /inheritance:r'
  nsExec::ExecToLog 'icacls "$COMMONPROGRAMDATA\SmartPrinter\Agent" /grant "SYSTEM:(OI)(CI)F" "BUILTIN\Administrators:(OI)(CI)F"'

  nsExec::ExecToLog 'sc.exe start $1'
!macroend

!macro customUnInstall
  DetailPrint "Removing SmartPrinter background service..."
  nsExec::ExecToLog 'sc.exe stop SmartPrinterAgent'
  nsExec::ExecToLog 'sc.exe delete SmartPrinterAgent'
  ; Local data (device credential, queue, logs) is left in place on uninstall by
  ; default, matching "preserve or clean data appropriately" - a shop owner reinstalling
  ; should not have to re-pair. Provide a separate "Remove all data" checkbox/flow if a
  ; full wipe is desired (see scripts/uninstall-service.ps1 -RemoveData for the manual
  ; equivalent).
!macroend
