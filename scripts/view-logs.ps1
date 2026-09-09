<#
.SYNOPSIS
    Tails the most recent SmartPrinter.Agent log file.
#>
$logDir = "$env:ProgramData\SmartPrinter\Agent\logs"
if (-not (Test-Path $logDir)) {
    Write-Error "No log directory found at $logDir - has the agent run yet?"
    exit 1
}
$latest = Get-ChildItem $logDir -Filter "agent-*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $latest) {
    Write-Error "No log files found in $logDir."
    exit 1
}
Write-Host "Tailing $($latest.FullName) (Ctrl+C to stop)..."
Get-Content -Path $latest.FullName -Wait -Tail 100
