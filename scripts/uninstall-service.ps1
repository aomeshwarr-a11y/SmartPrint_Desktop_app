<#
.SYNOPSIS
    Stops and removes the SmartPrinter.Agent Windows Service.
#>
param(
    [string]$ServiceName = "SmartPrinterAgent",
    [switch]$RemoveData
)

$ErrorActionPreference = "Stop"

$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "This script must be run as Administrator."
    exit 1
}

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    sc.exe delete $ServiceName | Out-Null
    Write-Host "Service '$ServiceName' removed."
} else {
    Write-Host "Service '$ServiceName' was not installed."
}

if ($RemoveData) {
    $dataDir = "$env:ProgramData\SmartPrinter\Agent"
    if (Test-Path $dataDir) {
        Remove-Item -Recurse -Force $dataDir
        Write-Host "Removed local data directory $dataDir (device credential, SQLite queue, logs)."
    }
}
