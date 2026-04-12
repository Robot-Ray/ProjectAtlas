const express = require("express");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const { promisify } = require("util");

const router = express.Router();
const execFileAsync = promisify(execFile);

const projectRoot = path.resolve(__dirname, "..", "..");
const windowsVmDir = path.join(projectRoot, "WindowsVm");
const windowsVmSharedRoot = path.join(windowsVmDir, "shared");
const composeFilePath = path.join(windowsVmDir, "docker-compose.yml");

const containerName = "windows";
const legacyContainerName = "dockvision-windows-vm";

const heartbeatFilePath = path.join(windowsVmSharedRoot, "agent-heartbeat.json");
const installLogPath = path.join(windowsVmSharedRoot, "agent-install-log.txt");
const taskFilePath = path.join(windowsVmSharedRoot, "agent-task.json");
const resultFilePath = path.join(windowsVmSharedRoot, "agent-result.json");

let launchInProgress = false;

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const raw = fs.readFileSync(filePath, "utf-8").trim();
    if (!raw) {
      return null;
    }

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

    const raw = fs.readFileSync(filePath, "utf-8");
    return raw.trim() ? raw : null;
  } catch (err) {
    console.error(`[readTextIfExists] Failed to read ${filePath}`, err);
    return null;
  }
}

function writeJson(filePath, value) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function deleteFileIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.warn(`[deleteFileIfExists] Failed to delete ${filePath}`, err.message);
  }
}

function buildTask(taskType = "open_notepad", payload = {}) {
  return {
    taskId: `task-${Date.now()}`,
    taskType,
    status: "queued",
    createdUtc: new Date().toISOString(),
    payload
  };
}

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

function buildStatusPayload(status) {
  const agentHeartbeat = readJsonIfExists(heartbeatFilePath);
  const agentInstallLog = readTextIfExists(installLogPath);
  const agentTask = readJsonIfExists(taskFilePath);
  const agentResult = readJsonIfExists(resultFilePath);

  return {
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
    agentHeartbeat,
    agentInstallLog,
    agentTask,
    agentResult
  };
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
    const taskType = req.body?.taskType || "open_notepad";
    const payload = req.body?.payload || {};
    const shouldQueueTask = req.body?.queueTask !== false;

    deleteFileIfExists(resultFilePath);

    if (shouldQueueTask) {
      writeJson(taskFilePath, buildTask(taskType, payload));
    }

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
      ...buildStatusPayload(status),
      message: "Windows VM launched successfully."
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

router.post("/task", async (req, res) => {
  try {
    const taskType = req.body?.taskType || "open_notepad";
    const payload = req.body?.payload || {};
    const task = buildTask(taskType, payload);

    writeJson(taskFilePath, task);

    return res.status(202).json({
      success: true,
      message: `Task '${taskType}' queued successfully.`,
      task
    });
  } catch (err) {
    console.error("[launcher task error]", err);

    return res.status(500).json({
      success: false,
      message: "Failed to queue task.",
      error: buildErrorMessage(err)
    });
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
    return res.json(buildStatusPayload(status));
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