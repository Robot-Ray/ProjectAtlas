# DockVision Guest Agent
# This script runs inside the Windows guest VM and acts as a simple task agent
# that uses a shared folder as the communication channel with the host.
# The agent discovers a shared folder, creates it if needed, writes a startup log,
# emits a recurring heartbeat, reads a task file, executes supported tasks,
# writes result and task status files, and keeps looping forever.

$ErrorActionPreference = "Stop"

# Ensure only one instance of the agent runs at a time.
$createdNew = $false
$script:AgentMutex = New-Object System.Threading.Mutex($true, "Global\DockVisionGuestAgent", [ref]$createdNew)
if (-not $createdNew) {
    exit 0
}

# Agent identity and heartbeat settings
$AgentName = "DockVision Guest Agent"
$AgentVersion = "0.3.0"
$HeartbeatIntervalSeconds = 15

function Get-UtcTimestamp {
    # Return a timestamp in ISO 8601 format for logs and status files.
    return [DateTime]::UtcNow.ToString("o")
}

function Resolve-SharedRoot {
    # Find the shared folder where the host and guest can exchange files.
    # Try known mount points first, then fall back to a local directory if none exist.
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

    # If no shared folder is available, create a fallback directory.
    $fallback = "C:\DockVision\shared-fallback"
    if (-not (Test-Path $fallback)) {
        New-Item -ItemType Directory -Force -Path $fallback | Out-Null
    }

    return $fallback
}

function Ensure-Directory {
    param([string]$Path)

    # Make sure the given path exists so the agent can write files there.
    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Force -Path $Path | Out-Null
    }
}

function Write-InstallLog {
    param(
        [string]$SharedRoot,
        [string]$Message
    )

    # Append a timestamped message to the agent install log in the shared root.
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

    # Emit a heartbeat JSON file that documents the agent status and machine info.
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

    # Read the host-provided task file from the shared folder.
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
        # If parsing fails, write an install log entry and ignore the malformed task.
        Write-InstallLog -SharedRoot $SharedRoot -Message ("Failed to parse task file: " + $_.Exception.Message)
        return $null
    }
}

function Write-TaskFile {
    param(
        [string]$SharedRoot,
        [object]$TaskObject
    )

    # Write the current task object back to disk, preserving status updates.
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

    # Write a result file for the completed task so the host can observe the outcome.
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

    # Update the task object to record completion status and timestamp.
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

    # Execute the current task and write results, while updating logs and heartbeat.
    $taskId = if ($Task.taskId) { [string]$Task.taskId } else { "unknown-task" }
    $taskType = if ($Task.taskType) { [string]$Task.taskType } else { "unknown" }

    Write-InstallLog -SharedRoot $SharedRoot -Message "Handling task '$taskId' of type '$taskType'."
    Write-Heartbeat -SharedRoot $SharedRoot -Status "running" -TaskName $taskType

    try {
        switch ($taskType) {
            "noop" {
                # A no-op task that simply returns success.
                Write-ResultFile -SharedRoot $SharedRoot -TaskId $taskId -Status "completed" -Message "No-op task completed."
            }

            "open_notepad" {
                # Example task: launch Notepad in the guest VM.
                Start-Process "notepad.exe"
                Write-ResultFile -SharedRoot $SharedRoot -TaskId $taskId -Status "completed" -Message "Notepad launched successfully."
            }

            default {
                # For unrecognized tasks, acknowledge receipt but do not fail.
                Write-ResultFile -SharedRoot $SharedRoot -TaskId $taskId -Status "completed" -Message "Prototype agent acknowledged task type '$taskType'."
            }
        }

        Mark-TaskFinished -SharedRoot $SharedRoot -TaskObject $Task -Status "completed"
    }
    catch {
        # If task execution fails, report failure and keep the task file updated.
        Write-InstallLog -SharedRoot $SharedRoot -Message ("Task failed: " + $_.Exception.Message)
        Write-ResultFile -SharedRoot $SharedRoot -TaskId $taskId -Status "failed" -Message $_.Exception.Message
        Mark-TaskFinished -SharedRoot $SharedRoot -TaskObject $Task -Status "failed"
    }
    finally {
        # Return the agent to idle state after handling the task.
        Write-Heartbeat -SharedRoot $SharedRoot -Status "idle" -TaskName "waiting_for_task"
    }
}

# Start the main agent flow:
# 1. Resolve the shared folder path.
# 2. Ensure the directory exists.
# 3. Log startup and begin the heartbeat/task loop.
$sharedRoot = Resolve-SharedRoot
Ensure-Directory -Path $sharedRoot

Write-InstallLog -SharedRoot $sharedRoot -Message "Agent startup begin."
Write-InstallLog -SharedRoot $sharedRoot -Message "Resolved shared root to: $sharedRoot"
Write-InstallLog -SharedRoot $sharedRoot -Message "Heartbeat loop starting."

while ($true) {
    try {
        # Emit heartbeat regularly so the host can see the agent is alive.
        Write-Heartbeat -SharedRoot $sharedRoot -Status "idle" -TaskName "waiting_for_task"

        # Check for a task file and only handle it if it is queued.
        $task = Read-TaskFile -SharedRoot $sharedRoot
        if ($task -and $task.status -eq "queued") {
            Handle-Task -SharedRoot $sharedRoot -Task $task
        }
    }
    catch {
        # Log any loop-level errors but keep the loop alive.
        try {
            Write-InstallLog -SharedRoot $sharedRoot -Message ("Agent loop error: " + $_.Exception.Message)
        }
        catch {
        }
    }

    Start-Sleep -Seconds $HeartbeatIntervalSeconds
}