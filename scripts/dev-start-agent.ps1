<#
.SYNOPSIS
    Runs the SmartPrinter.Agent as a plain console process for local development,
    without installing a Windows Service. See docs/DEVELOPMENT.md.
#>
Set-Location "$PSScriptRoot\..\services\desktop-agent\SmartPrinter.Agent"
dotnet run -- --console
