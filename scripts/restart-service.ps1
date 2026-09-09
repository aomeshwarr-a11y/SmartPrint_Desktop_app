param([string]$ServiceName = "SmartPrinterAgent")
Restart-Service -Name $ServiceName -Force
Get-Service -Name $ServiceName
