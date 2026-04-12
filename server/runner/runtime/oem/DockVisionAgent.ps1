$ErrorActionPreference = "Stop"

$createdNew = $false
$script:AgentMutex = New-Object System.Threading.Mutex($true, "Global\DockVisionGuestAgent", [ref]$createdNew)
if (-not $createdNew) {
    exit 0
}

$AgentName = "DockVision Guest Agent"
$AgentVersion = "0.3.0"
$HeartbeatIntervalSeconds = 15

function Get-UtcTimestamp {
    return [DateTime]::UtcNow.ToString("o")
}

function Resolve-SharedRoot {
    $candidates = @(
        "\\host.lan\Data",
        "C:\Users\Docker\Desktop\Shared",
        "C:\Users\Public\Desktop\Shared"
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    $fallback = "C:\DockVision\shared-fallback"
    if (-not (Test-Path $fallback)) {
        New-Item -ItemType Directory -Force -Path $fallback | Out-Null
    }

    return $fallback
}

function Ensure-Directory {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Force -Path $Path | Out-Null
    }
}

function Write-InstallLog {
    param(
        [string]$SharedRoot,
        [string]$Message
    )

    $installLogPath = Join-Path $SharedRoot "agent-install-log.txt"
    $timestamp = Get-UtcTimestamp
    Add-Content -Encoding UTF8 -Path $installLogPath -Value "[$timestamp] $Message"
}

function Write-Heartbeat {
    param(
        [string]$SharedRoot,
        [string]$Status = "idle",
        [string]$TaskName = "waiting_for_task"
    )

    $heartbeatPath = Join-Path $SharedRoot "agent-heartbeat.json"

    $payload = @{
        agent = @{
            name = $AgentName
            version = $AgentVersion
            status = $Status
            taskName = $TaskName
            intervalSeconds = $HeartbeatIntervalSeconds
        }
        machine = @{
            computerName = $env:COMPUTERNAME
            username = $env:USERNAME
            timestampUtc = Get-UtcTimestamp
            sharedRoot = $SharedRoot
        }
        prototype = @{
            notes = @(
                "Guest agent is running inside the Windows VM.",
                "Shared folder was detected successfully.",
                "Heartbeat is being written on a recurring loop."
            )
        }
    }

    $payload | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 -Path $heartbeatPath
}

function Read-TaskFile {
    param([string]$SharedRoot)

    $taskPath = Join-Path $SharedRoot "agent-task.json"

    if (-not (Test-Path $taskPath)) {
        return $null
    }

    try {
        $raw = Get-Content -Raw -Path $taskPath -Encoding UTF8
        if ([string]::IsNullOrWhiteSpace($raw)) {
            return $null
        }

        return $raw | ConvertFrom-Json
    }
    catch {
        Write-InstallLog -SharedRoot $SharedRoot -Message ("Failed to parse task file: " + $_.Exception.Message)
        return $null
    }
}

function Write-TaskFile {
    param(
        [string]$SharedRoot,
        [object]$TaskObject
    )

    $taskPath = Join-Path $SharedRoot "agent-task.json"
    $TaskObject | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 -Path $taskPath
}

function Write-ResultFile {
    param(
        [string]$SharedRoot,
        [string]$TaskId,
        [string]$Status,
        [string]$Message
    )

    $resultPath = Join-Path $SharedRoot "agent-result.json"

    $result = @{
        taskId = $TaskId
        status = $Status
        finishedUtc = Get-UtcTimestamp
        message = $Message
        artifacts = @{}
    }

    $result | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 -Path $resultPath
}

function Mark-TaskFinished {
    param(
        [string]$SharedRoot,
        [object]$TaskObject,
        [string]$Status
    )

    if ($TaskObject.PSObject.Properties.Name -contains "status") {
        $TaskObject.status = $Status
    }
    else {
        $TaskObject | Add-Member -NotePropertyName "status" -NotePropertyValue $Status -Force
    }

    if ($TaskObject.PSObject.Properties.Name -contains "completedUtc") {
        $TaskObject.completedUtc = Get-UtcTimestamp
    }
    else {
        $TaskObject | Add-Member -NotePropertyName "completedUtc" -NotePropertyValue (Get-UtcTimestamp) -Force
    }

    Write-TaskFile -SharedRoot $SharedRoot -TaskObject $TaskObject
}

function Handle-Task {
    param(
        [string]$SharedRoot,
        [object]$Task
    )

    $taskId = if ($Task.taskId) { [string]$Task.taskId } else { "unknown-task" }
    $taskType = if ($Task.taskType) { [string]$Task.taskType } else { "unknown" }

    Write-InstallLog -SharedRoot $SharedRoot -Message "Handling task '$taskId' of type '$taskType'."
    Write-Heartbeat -SharedRoot $SharedRoot -Status "running" -TaskName $taskType

    try {
        switch ($taskType) {
            "noop" {
                Write-ResultFile -SharedRoot $SharedRoot -TaskId $taskId -Status "completed" -Message "No-op task completed."
            }

            "open_notepad" {
                Start-Process "notepad.exe"
                Write-ResultFile -SharedRoot $SharedRoot -TaskId $taskId -Status "completed" -Message "Notepad launched successfully."
            }

            default {
                Write-ResultFile -SharedRoot $SharedRoot -TaskId $taskId -Status "completed" -Message "Prototype agent acknowledged task type '$taskType'."
            }
        }

        Mark-TaskFinished -SharedRoot $SharedRoot -TaskObject $Task -Status "completed"
    }
    catch {
        Write-InstallLog -SharedRoot $SharedRoot -Message ("Task failed: " + $_.Exception.Message)
        Write-ResultFile -SharedRoot $SharedRoot -TaskId $taskId -Status "failed" -Message $_.Exception.Message
        Mark-TaskFinished -SharedRoot $SharedRoot -TaskObject $Task -Status "failed"
    }
    finally {
        Write-Heartbeat -SharedRoot $SharedRoot -Status "idle" -TaskName "waiting_for_task"
    }
}

$sharedRoot = Resolve-SharedRoot
Ensure-Directory -Path $sharedRoot

Write-InstallLog -SharedRoot $sharedRoot -Message "Agent startup begin."
Write-InstallLog -SharedRoot $sharedRoot -Message "Resolved shared root to: $sharedRoot"
Write-InstallLog -SharedRoot $sharedRoot -Message "Heartbeat loop starting."

while ($true) {
    try {
        Write-Heartbeat -SharedRoot $sharedRoot -Status "idle" -TaskName "waiting_for_task"

        $task = Read-TaskFile -SharedRoot $sharedRoot
        if ($task -and $task.status -eq "queued") {
            Handle-Task -SharedRoot $sharedRoot -Task $task
        }
    }
    catch {
        try {
            Write-InstallLog -SharedRoot $sharedRoot -Message ("Agent loop error: " + $_.Exception.Message)
        }
        catch {
        }
    }

    Start-Sleep -Seconds $HeartbeatIntervalSeconds
}