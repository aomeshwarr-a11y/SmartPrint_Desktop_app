param([string]$ServiceName = "SmartPrinterAgent")
Stop-Service -Name $ServiceName -Force
Get-Service -Name $ServiceName
