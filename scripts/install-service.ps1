<#
.SYNOPSIS
    Installs SmartPrinter.Agent as a Windows Service and starts it.
.DESCRIPTION
    Run this AFTER `dotnet publish` has produced the agent binaries (see
    docs/DEPLOYMENT.md). Must be run from an elevated (Administrator) PowerShell prompt,
    since creating a Windows Service requires admin rights.
#>
param(
    [string]$PublishDir = "$PSScriptRoot\..\services\desktop-agent\SmartPrinter.Agent\bin\Release\net8.0-windows\win-x64\publish",
    [string]$ServiceName = "SmartPrinterAgent",
    [string]$DataDir = "$env:ProgramData\SmartPrinter\Agent"
)

$ErrorActionPreference = "Stop"

$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "This script must be run as Administrator."
    exit 1
}

$exePath = Join-Path $PublishDir "SmartPrinter.Agent.exe"
if (-not (Test-Path $exePath)) {
    Write-Error "Could not find $exePath - run dotnet publish first (see docs/DEPLOYMENT.md)."
    exit 1
}

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
# Restrict the data directory (contains the DPAPI-encrypted device credential and local
# SQLite queue) to Administrators and SYSTEM only.
icacls $DataDir /inheritance:r | Out-Null
icacls $DataDir /grant "SYSTEM:(OI)(CI)F" "BUILTIN\Administrators:(OI)(CI)F" | Out-Null

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Service '$ServiceName' already exists - stopping before reinstall."
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 2
}

sc.exe create $ServiceName binPath= "`"$exePath`"" start= auto DisplayName= "SmartPrinter Desktop Agent" | Out-Null
sc.exe description $ServiceName "Receives paid print jobs from SmartPrinter.in and sends them to this computer's printer." | Out-Null

# Restart automatically on failure AND on a clean exit (see IpcRouter.RequestServiceRestart)
sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null
sc.exe failureflag $ServiceName 1 | Out-Null

Start-Service -Name $ServiceName
Write-Host "SmartPrinter.Agent installed and started as Windows Service '$ServiceName'."
