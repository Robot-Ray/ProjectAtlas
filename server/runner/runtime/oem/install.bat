@echo off
set SCRIPT=C:\Windows\Temp\DockVisionAgent.ps1

echo [DockVision] OEM install starting...

if exist "%SCRIPT%" (
  powershell -ExecutionPolicy Bypass -File "%SCRIPT%"
) else (
  echo PowerShell bootstrap not found at %SCRIPT%
)