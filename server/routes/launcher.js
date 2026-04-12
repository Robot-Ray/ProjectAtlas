/**
 * ============================================================================
 * launcher.js
 * ============================================================================
 *
 * PURPOSE
 * -------
 * This route file acts as the local "control tower" for the Windows VM launcher.
 * It gives the React frontend a safe way to:
 *
 *   1. Start the VM
 *   2. Stop the VM
 *   3. Check current VM status
 *   4. Read outward metadata written by the guest agent
 *
 * HIGH-LEVEL FLOW
 * ---------------
 * User clicks a button in React
 *   -> React calls Express API
 *   -> This file runs Docker Compose commands
 *   -> Docker launches the Dockur Windows container
 *   -> The Windows VM boots inside that container
 *   -> The guest agent writes heartbeat/log files into the shared folder
 *   -> This file reads those files and returns them to the frontend
 *
 * ACTORS
 * ------
 * 1. React Frontend
 *    - Calls /api/launcher/start, /api/launcher/stop, /api/launcher/status
 *    - Displays launch state, viewer URL, and guest agent metadata
 *
 * 2. Express Backend
 *    - This file lives here
 *    - Translates frontend requests into Docker commands
 *    - Reads shared runtime files and returns JSON to the frontend
 *
 * 3. Docker Compose
 *    - Defined in WindowsVm/docker-compose.yml
 *    - Knows how to create the "windows" VM container correctly
 *
 * 4. Dockur Windows Container
 *    - Hosts the Windows VM
 *    - Exposes the browser viewer at http://127.0.0.1:8006/
 *
 * 5. Guest Agent inside the VM
 *    - Writes heartbeat and install-log files into the shared folder
 *    - This file reads those outputs and exposes them to the UI
 *
 * IMPORTANT PATHS
 * ---------------
 * projectRoot
 *   Root of the DockVision project
 *
 * windowsVmDir
 *   Folder containing docker-compose.yml for the VM
 *
 * windowsVmSharedRoot
 *   Host-side shared folder that the VM can write to
 *
 * composeFilePath
 *   Full path to WindowsVm/docker-compose.yml
 *
 * heartbeatFilePath
 *   Full path to agent-heartbeat.json written by the guest agent
 *
 * installLogPath
 *   Full path to agent-install-log.txt written by the guest agent
 *
 * IMPORTANT STATE
 * ---------------
 * launchInProgress
 *   In-memory flag used to prevent duplicate start requests from racing
 *
 * ROUTES
 * ------
 * POST /start
 *   Starts the VM using docker compose up -d
 *
 * POST /stop
 *   Stops the VM using docker compose down
 *
 * GET /status
 *   Returns current container status plus agent heartbeat/install log contents
 *
 * DESIGN NOTES
 * ------------
 * - The frontend never talks to Docker directly.
 * - Docker is controlled only through the backend.
 * - The backend does not directly "look inside" Windows.
 * - Instead, the guest agent writes outward-facing files into the shared folder.
 * - This keeps responsibilities separated and easier to reason about.
 * ============================================================================
 */

const express = require("express");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const { promisify } = require("util");

const router = express.Router();

/**
 * Promisified version of child_process.execFile so we can use async/await
 * instead of nested callbacks.
 */
const execFileAsync = promisify(execFile);

/**
 * ---------------------------------------------------------------------------
 * PATH SETUP
 * ---------------------------------------------------------------------------
 * These variables define where important project resources live.
 */

/**
 * Absolute path to the project root.
 * Example:
 * A:\Documents\...\DockVision
 */
const projectRoot = path.resolve(__dirname, "..", "..");

/**
 * Absolute path to the folder that contains the VM's docker-compose.yml file.
 * Example:
 * A:\Documents\...\DockVision\WindowsVm
 */
const windowsVmDir = path.join(projectRoot, "WindowsVm");

/**
 * Absolute path to the shared folder on the host side.
 * This folder is mounted into the VM/container so the guest agent can write
 * files outward for the backend to read.
 */
const windowsVmSharedRoot = path.join(windowsVmDir, "shared");

/**
 * Absolute path to the docker-compose.yml file that defines the VM container.
 */
const composeFilePath = path.join(windowsVmDir, "docker-compose.yml");

/**
 * ---------------------------------------------------------------------------
 * CONTAINER NAMES
 * ---------------------------------------------------------------------------
 */

/**
 * Name of the current VM container defined by Docker Compose.
 * This is the container we inspect for live state.
 */
const containerName = "windows";

/**
 * Old/legacy container name from earlier launcher experiments.
 * We remove it during start/stop flows so it does not conflict with the new
 * compose-based launcher path.
 */
const legacyContainerName = "dockvision-windows-vm";

/**
 * ---------------------------------------------------------------------------
 * AGENT OUTPUT FILES
 * ---------------------------------------------------------------------------
 * These are the files the guest agent is expected to write into the shared folder.
 */

/**
 * JSON heartbeat file written by the guest agent.
 * Expected to contain agent status, machine data, and optional prototype notes.
 */
const heartbeatFilePath = path.join(windowsVmSharedRoot, "agent-heartbeat.json");

/**
 * Plain-text install/startup log written by the guest agent.
 * Useful for proving that the guest-side agent actually started.
 */
const installLogPath = path.join(windowsVmSharedRoot, "agent-install-log.txt");

/**
 * ---------------------------------------------------------------------------
 * IN-MEMORY LAUNCH STATE
 * ---------------------------------------------------------------------------
 */

/**
 * Simple guard flag to prevent duplicate launch requests.
 * Example:
 * - User double-clicks Confirm
 * - Frontend retries too quickly
 *
 * This flag helps prevent starting the same VM multiple times at once.
 */
let launchInProgress = false;

/**
 * ============================================================================
 * FILE READING HELPERS
 * ============================================================================
 */

/**
 * Reads and parses a JSON file only if it exists and contains valid JSON.
 *
 * @param {string} filePath - Absolute path to the JSON file
 * @returns {object|null}
 *
 * Returns:
 * - parsed object if file exists and is valid JSON
 * - null if file does not exist
 * - null if file is empty
 * - null if parsing fails
 *
 * Why this exists:
 * The agent heartbeat is optional during early boot. We do not want the whole
 * route to crash just because the guest agent has not written the file yet.
 */
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

/**
 * Reads a text file only if it exists and is not blank.
 *
 * @param {string} filePath - Absolute path to the text file
 * @returns {string|null}
 *
 * Returns:
 * - file contents if file exists and has non-empty text
 * - null if file does not exist
 * - null if file is blank
 *
 * Why this exists:
 * The agent install log is optional and may not exist yet during early boot.
 */
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

/**
 * ============================================================================
 * DOCKER HELPERS
 * ============================================================================
 */

/**
 * Runs the Docker CLI with the supplied arguments.
 *
 * @param {string[]} args - Docker CLI arguments
 * @returns {Promise<{stdout: string, stderr: string}>}
 *
 * Why cwd matters:
 * We set the working directory to WindowsVm so Docker Compose commands run in
 * the correct folder context.
 *
 * Example:
 * runDocker(["compose", "-f", composeFilePath, "up", "-d"])
 */
async function runDocker(args) {
  return execFileAsync("docker", args, {
    cwd: windowsVmDir,
    windowsHide: true
  });
}

/**
 * Builds a readable error message from a Docker/child-process error.
 *
 * @param {Error} err
 * @returns {string}
 *
 * Why this exists:
 * Docker errors may appear in stderr, stdout, or message. This helper picks
 * the best available one so the frontend gets something meaningful back.
 */
function buildErrorMessage(err) {
  return (
    err?.stderr?.trim() ||
    err?.stdout?.trim() ||
    err?.message ||
    "Unknown Docker error."
  );
}

/**
 * Detects whether a Docker error simply means the target container does not exist.
 *
 * @param {Error} err
 * @returns {boolean}
 *
 * Why this exists:
 * "Missing container" is usually not a fatal problem for cleanup logic.
 * We do not want to scare the user with a harmless delete failure.
 */
function isMissingContainerError(err) {
  const message = buildErrorMessage(err);
  return /No such object|No such container/i.test(message);
}

/**
 * Safely removes a container if it exists.
 *
 * @param {string} name - Container name
 * @returns {Promise<void>}
 *
 * Why this exists:
 * We use this to clean up the old legacy container name before launching the
 * current Compose-driven VM path.
 */
async function safeRemoveContainer(name) {
  try {
    await runDocker(["rm", "-f", name]);
  } catch (err) {
    if (!isMissingContainerError(err)) {
      console.warn(`[docker rm] ${buildErrorMessage(err)}`);
    }
  }
}

/**
 * Reads the current status of the main VM container.
 *
 * @returns {Promise<string>}
 *
 * Common return values:
 * - "running"
 * - "exited"
 * - "created"
 * - "not_created"
 * - "unknown"
 *
 * Why this exists:
 * The frontend needs a clean status value to decide whether to show
 * Waiting / Launching / Running.
 */
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

/**
 * ============================================================================
 * RESPONSE BUILDER
 * ============================================================================
 */

/**
 * Creates the JSON payload returned to the frontend.
 *
 * @param {string} status - Docker container status
 * @returns {object}
 *
 * Why this exists:
 * We want /start and /status to return the same shape so the frontend can
 * consume both responses consistently.
 */
function buildStatusPayload(status) {
  const agentHeartbeat = readJsonIfExists(heartbeatFilePath);
  const agentInstallLog = readTextIfExists(installLogPath);

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
    agentInstallLog
  };
}

/**
 * ============================================================================
 * ROUTES
 * ============================================================================
 */

/**
 * POST /start
 * ---------------------------------------------------------------------------
 * Starts the Windows VM.
 *
 * What it does:
 * 1. Prevents double-launch if one is already in progress
 * 2. Removes the old legacy container name if it exists
 * 3. Runs docker compose up -d using the working compose file
 * 4. Inspects the container to get its current status
 * 5. Returns launch + agent metadata to the frontend
 */
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

    return res.status(202).json(buildStatusPayload(status));
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

/**
 * POST /stop
 * ---------------------------------------------------------------------------
 * Stops the Windows VM.
 *
 * What it does:
 * 1. Runs docker compose down
 * 2. Removes the old legacy container if it still exists
 * 3. Returns a success/failure response
 */
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

/**
 * GET /status
 * ---------------------------------------------------------------------------
 * Returns the current VM state plus any guest-agent outputs found in the
 * shared folder.
 *
 * What it does:
 * 1. Inspects the current Docker container state
 * 2. Reads heartbeat JSON if it exists
 * 3. Reads install log text if it exists
 * 4. Returns everything in one consistent response shape
 *
 * Why the frontend polls this route:
 * The Running Test page refreshes itself from this endpoint so the user can
 * see live launch/heartbeat updates without reopening the app.
 */
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

/**
 * Exports the router so server/index.js can mount it at /api/launcher.
 */
module.exports = router;