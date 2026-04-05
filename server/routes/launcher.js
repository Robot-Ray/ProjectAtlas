const express = require("express");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const router = express.Router();

let activeLaunchProcess = null;

const runnerPath = path.resolve(__dirname, "..", "runner", "runner.py");
const configPath = path.resolve(__dirname, "..", "runner", "config.json");

const runtimeRoot = path.resolve(__dirname, "..", "runner", "runtime");
const stateFilePath = path.join(runtimeRoot, "state", "launcher-status.json");
const heartbeatFilePath = path.join(runtimeRoot, "shared", "agent-heartbeat.json");
const installLogPath = path.join(runtimeRoot, "shared", "agent-install-log.txt");

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[readJsonIfExists] Failed to read ${filePath}`, err);
    return null;
  }
}

function readTextIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    return fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    console.error(`[readTextIfExists] Failed to read ${filePath}`, err);
    return null;
  }
}

function clearPreviousRuntimeArtifacts() {
  const filesToRemove = [stateFilePath, heartbeatFilePath, installLogPath];

  for (const filePath of filesToRemove) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.error(`[clearPreviousRuntimeArtifacts] Failed to delete ${filePath}`, err);
    }
  }
}

router.post("/start", (req, res) => {
  if (activeLaunchProcess) {
    return res.status(409).json({
      success: false,
      message: "A launcher process is already running."
    });
  }

  const isWindows = process.platform === "win32";
  const command = isWindows ? "py" : "python3";
  const args = isWindows
    ? ["-3", runnerPath, configPath]
    : [runnerPath, configPath];

  clearPreviousRuntimeArtifacts();

  try {
    const child = spawn(command, args, {
      cwd: path.resolve(__dirname, ".."),
      stdio: ["ignore", "pipe", "pipe"]
    });

    activeLaunchProcess = child;

    child.stdout.on("data", (data) => {
      console.log(`[runner stdout] ${data.toString()}`);
    });

    child.stderr.on("data", (data) => {
      console.error(`[runner stderr] ${data.toString()}`);
    });

    child.on("close", (code) => {
      console.log(`[runner exited] code=${code}`);
      activeLaunchProcess = null;
    });

    child.on("error", (err) => {
      console.error("[runner failed to start]", err);
      activeLaunchProcess = null;
    });

    return res.status(202).json({
      success: true,
      message: "Launcher started successfully."
    });
  } catch (err) {
    console.error("[launcher route error]", err);
    activeLaunchProcess = null;

    return res.status(500).json({
      success: false,
      message: "Failed to start launcher process."
    });
  }
});

router.get("/status", (req, res) => {
  const launchState = readJsonIfExists(stateFilePath);
  const agentHeartbeat = readJsonIfExists(heartbeatFilePath);
  const agentInstallLog = readTextIfExists(installLogPath);

  return res.json({
    success: true,
    launchInProgress: Boolean(activeLaunchProcess),
    launchState,
    agentHeartbeat,
    agentInstallLog
  });
});

module.exports = router;