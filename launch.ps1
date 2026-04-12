param(
    [switch]$SkipDockerCheck
)

$ErrorActionPreference = "Stop"

# ============================================================================
# DockVision launch.ps1
# ============================================================================
# Purpose:
# - Start the DockVision development environment from the repo root
# - Validate that key folders/files exist
# - Create expected runtime folders if they are missing
# - Optionally verify Docker is available
# - Run `npm run dev` from the project root
#
# Typical usage:
#   powershell -ExecutionPolicy Bypass -File .\launch.ps1
# ============================================================================

function Write-Step {
    param([string]$Message)
    Write-Host "[DockVision] $Message" -ForegroundColor Cyan
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[DockVision] WARNING: $Message" -ForegroundColor Yellow
}

function Write-Fail {
    param([string]$Message)
    Write-Host "[DockVision] ERROR: $Message" -ForegroundColor Red
}

function Require-Path {
    param(
        [string]$PathToCheck,
        [string]$Description
    )

    if (-not (Test-Path $PathToCheck)) {
        throw "$Description not found: $PathToCheck"
    }
}

function Ensure-Directory {
    param([string]$PathToCreate)

    if (-not (Test-Path $PathToCreate)) {
        New-Item -ItemType Directory -Force -Path $PathToCreate | Out-Null
        Write-Step "Created missing folder: $PathToCreate"
    }
}

function Test-CommandExists {
    param([string]$CommandName)

    return $null -ne (Get-Command $CommandName -ErrorAction SilentlyContinue)
}

try {
    $RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
    Set-Location $RepoRoot

    Write-Step "Repo root resolved to: $RepoRoot"

    # -------------------------------------------------------------------------
    # Validate expected project layout
    # -------------------------------------------------------------------------
    Require-Path -PathToCheck (Join-Path $RepoRoot "package.json") -Description "Root package.json"
    Require-Path -PathToCheck (Join-Path $RepoRoot "client") -Description "client folder"
    Require-Path -PathToCheck (Join-Path $RepoRoot "server") -Description "server folder"

    # -------------------------------------------------------------------------
    # Ensure runtime folders exist
    # -------------------------------------------------------------------------
    Ensure-Directory -PathToCreate (Join-Path $RepoRoot "server\runner\runtime\shared")
    Ensure-Directory -PathToCreate (Join-Path $RepoRoot "server\runner\runtime\state")
    Ensure-Directory -PathToCreate (Join-Path $RepoRoot "server\runner\runtime\oem")
    Ensure-Directory -PathToCreate (Join-Path $RepoRoot "WindowsVm\shared")
    Ensure-Directory -PathToCreate (Join-Path $RepoRoot "WindowsVm\OS")

    # -------------------------------------------------------------------------
    # Validate required commands
    # -------------------------------------------------------------------------
    if (-not (Test-CommandExists "node")) {
        throw "Node.js is not installed or not available in PATH."
    }

    if (-not (Test-CommandExists "npm")) {
        throw "npm is not installed or not available in PATH."
    }

    Write-Step "Node and npm detected."

    # -------------------------------------------------------------------------
    # Optional Docker check
    # -------------------------------------------------------------------------
    if (-not $SkipDockerCheck) {
        if (-not (Test-CommandExists "docker")) {
            Write-Warn "Docker CLI not found in PATH. Frontend/backend can still start, but VM launch features will fail."
        }
        else {
            try {
                $null = docker info 2>$null
                Write-Step "Docker is available."
            }
            catch {
                Write-Warn "Docker CLI exists, but Docker Desktop/engine may not be running yet."
            }
        }
    }
    else {
        Write-Warn "Skipping Docker availability check."
    }

    # -------------------------------------------------------------------------
    # Start the dev environment
    # -------------------------------------------------------------------------
    Write-Step "Starting DockVision dev environment with npm run dev..."
    npm run dev
}
catch {
    Write-Fail $_.Exception.Message
    exit 1
}