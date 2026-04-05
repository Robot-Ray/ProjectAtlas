@echo off
setlocal
mkdir C:\DockVision 2>nul
mkdir C:\DockVision\agent 2>nul

copy /Y C:\OEM\DockVisionAgent.ps1 C:\DockVision\agent\DockVisionAgent.ps1 >nul
copy /Y C:\OEM\DockVisionAgent.ps1 "%ProgramData%\Microsoft\Windows\Start Menu\Programs\StartUp\DockVisionAgent.ps1" >nul

powershell -ExecutionPolicy Bypass -File C:\DockVision\agent\DockVisionAgent.ps1
schtasks /Create /TN "DockVisionAgent" /SC ONLOGON /RL HIGHEST /TR "powershell -ExecutionPolicy Bypass -File C:\DockVision\agent\DockVisionAgent.ps1" /F

exit /b 0
