@echo off
setlocal

mkdir C:\DockVision 2>nul
mkdir C:\DockVision\agent 2>nul

if exist "C:\OEM\DockVisionAgent.ps1" (
  copy /Y "C:\OEM\DockVisionAgent.ps1" "C:\DockVision\agent\DockVisionAgent.ps1" >nul
) else if exist "\\host.lan\Data\DockVisionAgent.ps1" (
  copy /Y "\\host.lan\Data\DockVisionAgent.ps1" "C:\DockVision\agent\DockVisionAgent.ps1" >nul
) else if exist "C:\Users\Docker\Desktop\Shared\DockVisionAgent.ps1" (
  copy /Y "C:\Users\Docker\Desktop\Shared\DockVisionAgent.ps1" "C:\DockVision\agent\DockVisionAgent.ps1" >nul
) else (
  exit /b 1
)

start "" powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\DockVision\agent\DockVisionAgent.ps1"

schtasks /Create /TN "DockVisionAgent" /SC ONLOGON /RL HIGHEST /TR "powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\DockVision\agent\DockVisionAgent.ps1" /F

exit /b 0