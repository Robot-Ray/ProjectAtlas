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
const guestRuntimeSourceDir = path.join(projectRoot, "server", "runner", "runtime", "oem");

const containerName = "windows";
const legacyContainerName = "dockvision-windows-vm";

const heartbeatFilePath = path.join(windowsVmSharedRoot, "agent-heartbeat.json");
const installLogPath = path.join(windowsVmSharedRoot, "agent-install-log.txt");
const taskFilePath = path.join(windowsVmSharedRoot, "agent-task.json");
const resultFilePath = path.join(windowsVmSharedRoot, "agent-result.json");
const runtimeManifestPath = path.join(windowsVmSharedRoot, "dockvision-runtime.json");
const expectedAgentVersion = "0.3.0";
const heartbeatOnlineWindowSeconds = 90;

const guestRuntimeFiles = [
  ["DockVisionAgent.ps1", "DockVisionAgent.ps1"],
  ["install.bat", "install-agent.bat"],
  ["dockvision_notepad_task.py", "dockvision_notepad_task.py"]
];

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

function syncGuestRuntime() {
  fs.mkdirSync(windowsVmSharedRoot, { recursive: true });
  fs.mkdirSync(path.join(windowsVmSharedRoot, "screenshots"), { recursive: true });

  const copiedFiles = [];

  for (const [sourceName, targetName] of guestRuntimeFiles) {
    const sourcePath = path.join(guestRuntimeSourceDir, sourceName);
    const targetPath = path.join(windowsVmSharedRoot, targetName);

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Guest runtime source file is missing: ${sourcePath}`);
    }

    fs.copyFileSync(sourcePath, targetPath);
    copiedFiles.push(targetName);
  }

  const manifest = {
    syncedUtc: new Date().toISOString(),
    sourceDir: guestRuntimeSourceDir,
    sharedRoot: windowsVmSharedRoot,
    files: copiedFiles
  };

  writeJson(runtimeManifestPath, manifest);
  return manifest;
}

function buildDefaultPayload(taskType, payload) {
  if (taskType !== "open_notepad") {
    return payload;
  }

  return {
    text: [
      "DockVision Notepad proof of concept",
      `Task queued at ${new Date().toISOString()}`,
      "Typed through the guest automation path."
    ].join("\r\n"),
    typingDelayMs: 35,
    captureScreenshot: true,
    saveFile: false,
    closeAfter: false,
    ...payload
  };
}

function buildTask(taskType = "open_notepad", payload = {}) {
  return {
    taskId: `task-${Date.now()}`,
    taskType,
    status: "queued",
    createdUtc: new Date().toISOString(),
    payload: buildDefaultPayload(taskType, payload)
  };
}

function buildQueuedResult(task) {
  return {
    taskId: task.taskId,
    status: "queued",
    finishedUtc: null,
    message: "Task queued; waiting for the Windows guest agent.",
    artifacts: {},
    details: {
      taskType: task.taskType
    }
  };
}

function secondsSince(timestamp) {
  if (!timestamp) {
    return null;
  }

  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return Math.max(0, Math.round((Date.now() - parsed) / 1000));
}

function buildGuestAgentStatus(containerStatus, heartbeat, task) {
  const heartbeatTime = heartbeat?.machine?.timestampUtc;
  const heartbeatAgeSeconds = secondsSince(heartbeatTime);
  const currentVersion = heartbeat?.agent?.version || null;
  const heartbeatSeen = Boolean(heartbeat);
  const online =
    heartbeatSeen &&
    heartbeatAgeSeconds !== null &&
    heartbeatAgeSeconds <= heartbeatOnlineWindowSeconds;
  const current = currentVersion === expectedAgentVersion;
  const queuedTaskAgeSeconds = task?.status === "queued" ? secondsSince(task.createdUtc) : null;

  let state = "not_installed";
  let message = "No guest heartbeat has been seen yet. Start the VM and run install-agent.bat once inside Windows.";

  if (heartbeatSeen && !current) {
    state = "upgrade_needed";
    message = `Guest agent version ${currentVersion || "unknown"} is installed; expected ${expectedAgentVersion}. Run install-agent.bat inside Windows once to upgrade it.`;
  } else if (heartbeatSeen && !online && containerStatus === "running") {
    state = "stale";
    message = "The VM is running, but the guest heartbeat is stale. The agent may not be running inside Windows.";
  } else if (heartbeatSeen && !online) {
    state = "offline";
    message = "Guest agent heartbeat exists, but it is stale because the VM is not currently reporting.";
  } else if (online && current) {
    state = "ready";
    message = "Guest agent is current and reporting through the shared folder.";
  }

  if (queuedTaskAgeSeconds !== null && queuedTaskAgeSeconds > heartbeatOnlineWindowSeconds && state !== "ready") {
    message = `${message} A queued task has been waiting for ${queuedTaskAgeSeconds} seconds.`;
  }

  return {
    state,
    message,
    expectedVersion: expectedAgentVersion,
    currentVersion,
    online,
    current,
    heartbeatAgeSeconds,
    heartbeatOnlineWindowSeconds,
    queuedTaskAgeSeconds
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
  const guestRuntime = readJsonIfExists(runtimeManifestPath);
  const guestAgent = buildGuestAgentStatus(status, agentHeartbeat, agentTask);

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
    agentResult,
    guestRuntime,
    guestAgent
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

    syncGuestRuntime();

    if (shouldQueueTask) {
      const task = buildTask(taskType, payload);
      writeJson(resultFilePath, buildQueuedResult(task));
      writeJson(taskFilePath, task);
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

    syncGuestRuntime();
    writeJson(resultFilePath, buildQueuedResult(task));
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
