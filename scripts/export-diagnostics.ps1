<#
.SYNOPSIS
    Fallback diagnostics export directly from PowerShell (zips the current logs
    directory). Prefer the in-app "Export diagnostics" button (Diagnostics screen) when
    the Electron UI is open, since it also includes service status and recent job
    history in the bundle - this script is for when the UI itself won't launch.
#>
$logDir = "$env:ProgramData\SmartPrinter\Agent\logs"
$outDir = "$env:TEMP\SmartPrinterDiagnostics"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$zipPath = Join-Path $outDir "diagnostics-fallback-$(Get-Date -Format yyyyMMdd-HHmmss).zip"

if (Test-Path $logDir) {
    Compress-Archive -Path "$logDir\*" -DestinationPath $zipPath -Force
    Write-Host "Diagnostics bundle written to $zipPath"
    Invoke-Item $outDir
} else {
    Write-Error "No log directory found at $logDir."
}
