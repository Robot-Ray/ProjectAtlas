#!/usr/bin/env python3
"""
DockVision prototype VM launcher.

What this does right now:
1. Reads a JSON config file.
2. Creates the runtime folders the prototype needs.
3. Generates an OEM payload that Dockur/Windows will execute inside the VM.
4. Launches the Windows VM container with `docker run`.
5. Writes a launcher status file that the Express backend can return to React.

Why the OEM payload matters:
The dockur/windows image supports mounting a host folder to /oem and executing
install.bat during automatic Windows setup. That gives us a clean prototype path
for the future "inner agent" without making the frontend talk to Docker directly.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass
class LaunchResult:
    success: bool
    message: str
    container_name: str
    viewer_url: str | None = None
    rdp_host: str | None = None
    rdp_port: int | None = None
    container_id: str | None = None
    container_status: str | None = None
    state_file: str | None = None
    shared_dir: str | None = None


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def resolve_path(base_dir: Path, raw_path: str) -> Path:
    candidate = Path(raw_path)
    return candidate if candidate.is_absolute() else (base_dir / candidate).resolve()


def run_command(command: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, capture_output=True, text=True, check=check)


def docker_available() -> tuple[bool, str]:
    try:
        result = run_command(["docker", "info"], check=True)
        return True, result.stdout.strip() or "Docker is reachable."
    except FileNotFoundError:
        return False, "Docker CLI was not found on PATH."
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or "").strip()
        stdout = (exc.stdout or "").strip()
        return False, stderr or stdout or "Docker is not reachable."


def inspect_container_status(container_name: str) -> str | None:
    try:
        result = run_command(
            ["docker", "inspect", "-f", "{{.State.Status}}", container_name],
            check=True,
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError:
        return None


def inspect_container_id(container_name: str) -> str | None:
    try:
        result = run_command(
            ["docker", "inspect", "-f", "{{.Id}}", container_name],
            check=True,
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError:
        return None


def ensure_runtime_folders(config_dir: Path, config: dict[str, Any]) -> dict[str, Path]:
    raw_paths = config["paths"]
    resolved = {
        key: resolve_path(config_dir, value)
        for key, value in raw_paths.items()
    }
    for folder in resolved.values():
        folder.mkdir(parents=True, exist_ok=True)
    return resolved


def build_install_bat(task_name: str) -> str:
    return rf"""@echo off
setlocal
mkdir C:\DockVision 2>nul
mkdir C:\DockVision\agent 2>nul

copy /Y C:\OEM\DockVisionAgent.ps1 C:\DockVision\agent\DockVisionAgent.ps1 >nul
copy /Y C:\OEM\DockVisionAgent.ps1 "%ProgramData%\Microsoft\Windows\Start Menu\Programs\StartUp\DockVisionAgent.ps1" >nul

powershell -ExecutionPolicy Bypass -File C:\DockVision\agent\DockVisionAgent.ps1
schtasks /Create /TN "{task_name}" /SC ONLOGON /RL HIGHEST /TR "powershell -ExecutionPolicy Bypass -File C:\DockVision\agent\DockVisionAgent.ps1" /F

exit /b 0
"""


def build_agent_ps1(config: dict[str, Any]) -> str:
    heartbeat_file = config["agent"]["heartbeat_file"]
    install_log_file = config["agent"]["install_log_file"]
    task_name = config["agent"]["task_name"]
    run_interval = config["agent"]["run_interval_minutes"]

    # The script prefers the Desktop Shared folder that Dockur exposes,
    # and falls back to a local folder if that location is not ready yet.
    return rf"""$ErrorActionPreference = 'Stop'

function Resolve-SharedRoot {{
    $candidates = @(
        'C:\Users\Docker\Desktop\Shared',
        'C:\Users\Public\Desktop\Shared',
        '\\host.lan\Data'
    )

    foreach ($candidate in $candidates) {{
        if (Test-Path $candidate) {{
            return $candidate
        }}
    }}

    $fallback = 'C:\DockVision\shared-fallback'
    New-Item -ItemType Directory -Force -Path $fallback | Out-Null
    return $fallback
}}

function Write-JsonFile([string]$Path, [hashtable]$Payload) {{
    $folder = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $folder | Out-Null
    $Payload | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 -Path $Path
}}

$sharedRoot = Resolve-SharedRoot
$heartbeatPath = Join-Path $sharedRoot '{heartbeat_file}'
$installLogPath = Join-Path $sharedRoot '{install_log_file}'
$localStateRoot = 'C:\DockVision\state'
New-Item -ItemType Directory -Force -Path $localStateRoot | Out-Null

$payload = @{{
    agent = @{{
        name = 'DockVision prototype agent'
        taskName = '{task_name}'
        intervalMinutes = {run_interval}
        status = 'online'
    }}
    machine = @{{
        computerName = $env:COMPUTERNAME
        username = $env:USERNAME
        timestampUtc = [DateTime]::UtcNow.ToString('o')
        sharedRoot = $sharedRoot
    }}
    prototype = @{{
        phase = 'bootstrap'
        nextStep = 'replace heartbeat script with real test-step execution'
        notes = @(
            'VM launched through Docker container',
            'OEM install.bat executed successfully',
            'Agent proved it can write state outward to the host-visible shared area'
        )
    }}
}}

Write-JsonFile -Path $heartbeatPath -Payload $payload
Set-Content -Encoding UTF8 -Path $installLogPath -Value ("DockVision agent heartbeat written at " + [DateTime]::UtcNow.ToString('o'))
"""


def generate_oem_payload(paths: dict[str, Path], config: dict[str, Any]) -> None:
    if not config["agent"].get("enabled", True):
        return

    oem_dir = paths["oem"]
    install_bat = oem_dir / "install.bat"
    agent_ps1 = oem_dir / "DockVisionAgent.ps1"

    install_bat.write_text(
        build_install_bat(config["agent"]["task_name"]),
        encoding="utf-8",
        newline="\r\n",
    )
    agent_ps1.write_text(build_agent_ps1(config), encoding="utf-8", newline="\r\n")


def build_docker_run_command(config: dict[str, Any], paths: dict[str, Path]) -> list[str]:
    run_cfg = config["run"]
    windows_cfg = config["windows"]
    docker_cfg = config["docker"]

    command: list[str] = ["docker", "run"]

    if docker_cfg.get("detach", True):
        command.append("-d")

    pull_policy = run_cfg.get("pull_policy")
    if pull_policy:
        command.extend(["--pull", str(pull_policy)])

    command.extend(["--name", run_cfg["name"]])
    command.extend(["--restart", docker_cfg.get("restart", "unless-stopped")])
    command.extend(["--stop-timeout", str(docker_cfg.get("stop_timeout", 120))])

    for port in docker_cfg.get("ports", []):
        host_port = port["host"]
        container_port = port["container"]
        protocol = port.get("protocol", "tcp")
        command.extend(["-p", f"{host_port}:{container_port}/{protocol}"])

    for device in docker_cfg.get("devices", []):
        command.extend(["--device", device])

    for capability in docker_cfg.get("cap_add", []):
        command.extend(["--cap-add", capability])

    command.extend(["-e", f"VERSION={windows_cfg['version']}"])
    command.extend(["-e", f"DISK_SIZE={windows_cfg['disk_size']}"])
    command.extend(["-e", f"RAM_SIZE={windows_cfg['ram_size']}"])
    command.extend(["-e", f"CPU_CORES={windows_cfg['cpu_cores']}"])
    command.extend(["-e", f"USERNAME={windows_cfg['username']}"])
    command.extend(["-e", f"PASSWORD={windows_cfg['password']}"])
    command.extend(["-e", f"LANGUAGE={windows_cfg['language']}"])
    command.extend(["-e", f"REGION={windows_cfg['region']}"])
    command.extend(["-e", f"KEYBOARD={windows_cfg['keyboard']}"])

    command.extend(["-v", f"{paths['windows_storage']}:/storage"])
    command.extend(["-v", f"{paths['shared']}:/shared"])
    command.extend(["-v", f"{paths['oem']}:/oem"])

    command.append(run_cfg["image"])
    return command


def stop_and_remove_container(container_name: str) -> None:
    run_command(["docker", "rm", "-f", container_name], check=True)


def start_existing_container(container_name: str) -> None:
    run_command(["docker", "start", container_name], check=True)


def write_launcher_state(config: dict[str, Any], paths: dict[str, Path], result: LaunchResult) -> Path:
    state_file = paths["state"] / config["agent"]["launch_status_file"]
    payload = {
        "timestampUtc": utc_now(),
        "success": result.success,
        "message": result.message,
        "container": {
            "name": result.container_name,
            "id": result.container_id,
            "status": result.container_status,
        },
        "endpoints": {
            "viewerUrl": result.viewer_url,
            "rdpHost": result.rdp_host,
            "rdpPort": result.rdp_port,
        },
        "paths": {
            "shared": result.shared_dir,
            "stateFile": str(state_file),
        },
    }
    write_json(state_file, payload)
    return state_file


def launch_vm(config_path: Path) -> LaunchResult:
    config = read_json(config_path)
    config_dir = config_path.parent
    paths = ensure_runtime_folders(config_dir, config)
    generate_oem_payload(paths, config)

    docker_ok, docker_message = docker_available()
    if not docker_ok:
        return LaunchResult(
            success=False,
            message=f"Docker check failed: {docker_message}",
            container_name=config["run"]["name"],
            viewer_url=config["launch"].get("viewer_url"),
            rdp_host=config["launch"].get("rdp_host"),
            rdp_port=config["launch"].get("rdp_port"),
            shared_dir=str(paths["shared"]),
        )

    container_name = config["run"]["name"]
    existing_status = inspect_container_status(container_name)

    if existing_status == "running":
        return LaunchResult(
            success=True,
            message="Container is already running.",
            container_name=container_name,
            viewer_url=config["launch"].get("viewer_url"),
            rdp_host=config["launch"].get("rdp_host"),
            rdp_port=config["launch"].get("rdp_port"),
            container_id=inspect_container_id(container_name),
            container_status=existing_status,
            shared_dir=str(paths["shared"]),
        )

    if existing_status and config["run"].get("remove_existing", False):
        stop_and_remove_container(container_name)
        existing_status = None

    if existing_status and config["run"].get("start_if_stopped", True):
        start_existing_container(container_name)
        return LaunchResult(
            success=True,
            message="Existing container started.",
            container_name=container_name,
            viewer_url=config["launch"].get("viewer_url"),
            rdp_host=config["launch"].get("rdp_host"),
            rdp_port=config["launch"].get("rdp_port"),
            container_id=inspect_container_id(container_name),
            container_status=inspect_container_status(container_name),
            shared_dir=str(paths["shared"]),
        )

    command = build_docker_run_command(config, paths)

    try:
        result = run_command(command, check=True)
    except subprocess.CalledProcessError as exc:
        message = (exc.stderr or exc.stdout or "Docker run failed.").strip()
        return LaunchResult(
            success=False,
            message=message,
            container_name=container_name,
            viewer_url=config["launch"].get("viewer_url"),
            rdp_host=config["launch"].get("rdp_host"),
            rdp_port=config["launch"].get("rdp_port"),
            shared_dir=str(paths["shared"]),
        )

    return LaunchResult(
        success=True,
        message="VM container launched.",
        container_name=container_name,
        viewer_url=config["launch"].get("viewer_url"),
        rdp_host=config["launch"].get("rdp_host"),
        rdp_port=config["launch"].get("rdp_port"),
        container_id=result.stdout.strip() or inspect_container_id(container_name),
        container_status=inspect_container_status(container_name),
        shared_dir=str(paths["shared"]),
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Launch the DockVision prototype Windows VM.")
    parser.add_argument(
        "config",
        nargs="?",
        default="dockvision_vm_run_config.json",
        help="Path to the launcher config JSON file.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config_path = Path(args.config).resolve()

    if not config_path.exists():
        payload = {
            "success": False,
            "message": f"Config file not found: {config_path}",
        }
        print(json.dumps(payload, indent=2))
        return 1

    result = launch_vm(config_path)
    config = read_json(config_path)
    paths = ensure_runtime_folders(config_path.parent, config)
    state_file = write_launcher_state(config, paths, result)

    payload = {
        "success": result.success,
        "message": result.message,
        "container": {
            "name": result.container_name,
            "id": result.container_id,
            "status": result.container_status,
        },
        "endpoints": {
            "viewerUrl": result.viewer_url,
            "rdpHost": result.rdp_host,
            "rdpPort": result.rdp_port,
        },
        "paths": {
            "shared": result.shared_dir,
            "stateFile": str(state_file),
        },
    }

    print(json.dumps(payload, indent=2))
    return 0 if result.success else 1


if __name__ == "__main__":
    sys.exit(main())
