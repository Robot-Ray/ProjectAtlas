const express = require("express");
const path = require("path");
const { spawn } = require("child_process");

const router = express.Router();

let activeLaunchProcess = null;

router.post("/start", (req, res) => {
  if (activeLaunchProcess) {
    return res.status(409).json({
      success: false,
      message: "A launcher process is already running."
    });
  }

  const runnerPath = path.resolve(__dirname, "..", "runner", "runner.py");
  const configPath = path.resolve(__dirname, "..", "runner", "config.json");

  const isWindows = process.platform === "win32";

  const command = isWindows ? "py" : "python3";
  const args = isWindows
    ? ["-3", runnerPath, configPath]
    : [runnerPath, configPath];

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

module.exports = router;