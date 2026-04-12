@echo off
setlocal

REM ============================================================================
REM DockVision launch.bat
REM ============================================================================
REM Purpose:
REM - Start the DockVision development environment from the repo root
REM - Validate that key folders/files exist
REM - Create expected runtime folders if they are missing
REM - Optionally verify Docker is available
REM - Run `npm run dev` from the project root
REM
REM Typical usage:
REM   launch.bat
REM ============================================================================

set "REPO_ROOT=%~dp0"
cd /d "%REPO_ROOT%"

echo [DockVision] Repo root resolved to: %REPO_ROOT%

REM --------------------------------------------------------------------------
REM Validate expected project layout
REM --------------------------------------------------------------------------
if not exist "%REPO_ROOT%package.json" (
  echo [DockVision] ERROR: Root package.json not found.
  exit /b 1
)

if not exist "%REPO_ROOT%client" (
  echo [DockVision] ERROR: client folder not found.
  exit /b 1
)

if not exist "%REPO_ROOT%server" (
  echo [DockVision] ERROR: server folder not found.
  exit /b 1
)

REM --------------------------------------------------------------------------
REM Ensure runtime folders exist
REM --------------------------------------------------------------------------
if not exist "%REPO_ROOT%server\runner\runtime\shared" (
  mkdir "%REPO_ROOT%server\runner\runtime\shared"
  echo [DockVision] Created missing folder: server\runner\runtime\shared
)

if not exist "%REPO_ROOT%server\runner\runtime\state" (
  mkdir "%REPO_ROOT%server\runner\runtime\state"
  echo [DockVision] Created missing folder: server\runner\runtime\state
)

if not exist "%REPO_ROOT%server\runner\runtime\oem" (
  mkdir "%REPO_ROOT%server\runner\runtime\oem"
  echo [DockVision] Created missing folder: server\runner\runtime\oem
)

if not exist "%REPO_ROOT%WindowsVm\shared" (
  mkdir "%REPO_ROOT%WindowsVm\shared"
  echo [DockVision] Created missing folder: WindowsVm\shared
)

if not exist "%REPO_ROOT%WindowsVm\OS" (
  mkdir "%REPO_ROOT%WindowsVm\OS"
  echo [DockVision] Created missing folder: WindowsVm\OS
)

REM --------------------------------------------------------------------------
REM Validate required commands
REM --------------------------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo [DockVision] ERROR: Node.js is not installed or not available in PATH.
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [DockVision] ERROR: npm is not installed or not available in PATH.
  exit /b 1
)

echo [DockVision] Node and npm detected.

REM --------------------------------------------------------------------------
REM Optional Docker check
REM --------------------------------------------------------------------------
where docker >nul 2>nul
if errorlevel 1 (
  echo [DockVision] WARNING: Docker CLI not found in PATH. Frontend/backend can still start, but VM launch features will fail.
) else (
  docker info >nul 2>nul
  if errorlevel 1 (
    echo [DockVision] WARNING: Docker CLI exists, but Docker Desktop/engine may not be running yet.
  ) else (
    echo [DockVision] Docker is available.
  )
)

REM --------------------------------------------------------------------------
REM Start the dev environment
REM --------------------------------------------------------------------------
echo [DockVision] Starting DockVision dev environment with npm run dev...
call npm run dev

endlocal