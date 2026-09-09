<#
.SYNOPSIS
    Builds the C# agent, the shared contracts package, and the Electron UI in one pass.
#>
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."

Write-Host "==> Building SmartPrinter.Agent"
Push-Location "$root\services\desktop-agent"
dotnet restore
dotnet build -c Release
Pop-Location

Write-Host "==> Installing Node dependencies"
Push-Location $root
npm install
Pop-Location

Write-Host "==> Building desktop UI"
Push-Location "$root\apps\desktop-ui"
npm run build
Pop-Location

Write-Host "All builds completed."
