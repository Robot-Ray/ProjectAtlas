const express = require("express");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const router = express.Router();
const execFileAsync = promisify(execFile);

const projectRoot = path.resolve(__dirname, "..", "..");
const windowsVmDir = path.join(projectRoot, "WindowsVm");
const composeFilePath = path.join(windowsVmDir, "docker-compose.yml");
const containerName = "windows";
const legacyContainerName = "dockvision-windows-vm";

let launchInProgress = false;

async function runDocker(args) {
  return execFileAsync("docker", args, {
    cwd: windowsVmDir,
    windowsHide: true
  });
}

function buildErrorMessage(err) {
  return (
    err?.stderr?.trim() ||
    err?.stdout?.trim() ||
    err?.message ||
    "Unknown Docker error."
  );
}

function isMissingContainerError(err) {
  const message = buildErrorMessage(err);
  return /No such object|No such container/i.test(message);
}

async function safeRemoveContainer(name) {
  try {
    await runDocker(["rm", "-f", name]);
  } catch (err) {
    if (!isMissingContainerError(err)) {
      console.warn(`[docker rm] ${buildErrorMessage(err)}`);
    }
  }
}

async function getContainerStatus() {
  try {
    const { stdout } = await runDocker([
      "inspect",
      containerName,
      "--format",
      "{{.State.Status}}"
    ]);

    return stdout.trim() || "unknown";
  } catch (err) {
    if (isMissingContainerError(err)) {
      return "not_created";
    }

    throw err;
  }
}

router.post("/start", async (req, res) => {
  if (launchInProgress) {
    return res.status(409).json({
      success: false,
      message: "A VM launch is already in progress."
    });
  }

  launchInProgress = true;

  try {
    await safeRemoveContainer(legacyContainerName);

    await runDocker([
      "compose",
      "-f",
      composeFilePath,
      "up",
      "-d"
    ]);

    const status = await getContainerStatus();

    return res.status(202).json({
      success: true,
      message: "Windows VM launched successfully.",
      launchInProgress: false,
      launchState: {
        source: "docker-compose",
        containerName,
        composeFile: composeFilePath,
        status,
        running: status === "running",
        webUrl: "http://127.0.0.1:8006/"
      },
      agentHeartbeat: null,
      agentInstallLog: null
    });
  } catch (err) {
    console.error("[launcher start error]", err);

    return res.status(500).json({
      success: false,
      message: "Failed to launch Windows VM.",
      error: buildErrorMessage(err)
    });
  } finally {
    launchInProgress = false;
  }
});

router.post("/stop", async (req, res) => {
  try {
    await runDocker([
      "compose",
      "-f",
      composeFilePath,
      "down"
    ]);

    await safeRemoveContainer(legacyContainerName);

    return res.json({
      success: true,
      message: "Windows VM stopped successfully."
    });
  } catch (err) {
    console.error("[launcher stop error]", err);

    return res.status(500).json({
      success: false,
      message: "Failed to stop Windows VM.",
      error: buildErrorMessage(err)
    });
  }
});

router.get("/status", async (req, res) => {
  try {
    const status = await getContainerStatus();

    return res.json({
      success: true,
      launchInProgress,
      launchState: {
        source: "docker-compose",
        containerName,
        composeFile: composeFilePath,
        status,
        running: status === "running",
        webUrl: "http://127.0.0.1:8006/"
      },
      agentHeartbeat: null,
      agentInstallLog: null
    });
  } catch (err) {
    console.error("[launcher status error]", err);

    return res.status(500).json({
      success: false,
      message: "Failed to read Windows VM status.",
      error: buildErrorMessage(err)
    });
  }
});

module.exports = router;