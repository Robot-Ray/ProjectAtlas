$ErrorActionPreference = 'Stop'

function Resolve-SharedRoot {
    $candidates = @(
        'C:\Users\Docker\Desktop\Shared',
        'C:\Users\Public\Desktop\Shared',
        '\\host.lan\Data'
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    $fallback = 'C:\DockVision\shared-fallback'
    New-Item -ItemType Directory -Force -Path $fallback | Out-Null
    return $fallback
}

function Write-JsonFile([string]$Path, [hashtable]$Payload) {
    $folder = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $folder | Out-Null
    $Payload | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 -Path $Path
}

$sharedRoot = Resolve-SharedRoot
$heartbeatPath = Join-Path $sharedRoot 'agent-heartbeat.json'
$installLogPath = Join-Path $sharedRoot 'agent-install-log.txt'
$localStateRoot = 'C:\DockVision\state'
New-Item -ItemType Directory -Force -Path $localStateRoot | Out-Null

$payload = @{
    agent = @{
        name = 'DockVision prototype agent'
        taskName = 'DockVisionAgent'
        intervalMinutes = 1
        status = 'online'
    }
    machine = @{
        computerName = $env:COMPUTERNAME
        username = $env:USERNAME
        timestampUtc = [DateTime]::UtcNow.ToString('o')
        sharedRoot = $sharedRoot
    }
    prototype = @{
        phase = 'bootstrap'
        nextStep = 'replace heartbeat script with real test-step execution'
        notes = @(
            'VM launched through Docker container',
            'OEM install.bat executed successfully',
            'Agent proved it can write state outward to the host-visible shared area'
        )
    }
}

Write-JsonFile -Path $heartbeatPath -Payload $payload
Set-Content -Encoding UTF8 -Path $installLogPath -Value ("DockVision agent heartbeat written at " + [DateTime]::UtcNow.ToString('o'))
