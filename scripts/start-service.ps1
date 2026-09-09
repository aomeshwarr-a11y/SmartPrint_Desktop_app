param([string]$ServiceName = "SmartPrinterAgent")
Start-Service -Name $ServiceName
Get-Service -Name $ServiceName
