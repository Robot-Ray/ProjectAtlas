/**
 * ============================================================================
 * index.js
 * ============================================================================
 *
 * PURPOSE
 * -------
 * This file is the main entry point for the Express backend.
 *
 * Its job is to:
 *   1. Create the Express application
 *   2. Turn on middleware the app needs
 *   3. Register route files
 *   4. Start the backend server on a local port
 *
 * HIGH-LEVEL ROLE FOR PROJECT ATLAS
 * ------------------------------
 * This file is the "front door" of the backend.
 *
 * The React frontend does not talk directly to Docker, the VM, or the guest
 * agent. Instead, React sends HTTP requests to this Express server.
 *
 * This file receives those requests and hands them off to more specialized
 * route files, such as:
 *
 *   /api/launcher
 *
 * That means this file is not responsible for actually launching the VM.
 * It is responsible for setting up the backend application so the correct
 * route modules can handle that work.
 *
 * ACTORS
 * ------
 * 1. React Frontend
 *    - Sends requests to this backend
 *    - Example: GET /api/launcher/status
 *    - Example: POST /api/launcher/start
 *
 * 2. Express App
 *    - Created here
 *    - Receives incoming requests
 *    - Applies middleware
 *    - Passes requests to the correct route handlers
 *
 * 3. Launcher Routes
 *    - Imported from ./routes/launcher
 *    - Handles VM start / stop / status logic
 *
 * 4. Local Machine Services
 *    - Docker
 *    - Docker Compose
 *    - Shared runtime files
 *    - These are not handled directly here, but downstream in route files
 *
 * WHY THIS FILE MATTERS
 * ---------------------
 * Even though this file is short, it is important because it connects the
 * entire backend together.
 *
 * Without this file:
 * - the frontend would have nowhere to send requests
 * - the launcher route would never be reachable
 * - the local API would not exist
 *
 * DESIGN INTENT
 * -------------
 * Keep this file simple.
 *
 * This file should only do application setup:
 * - app creation
 * - middleware registration
 * - route mounting
 * - server startup
 *
 * Business logic should stay in route/controller files, not here.
 * ============================================================================
 */

/**
 * Express is the backend framework used to create the local API server.
 * It gives us:
 * - routing
 * - middleware support
 * - request/response handling
 */
const express = require("express");

/**
 * CORS allows the frontend and backend to talk to each other across origins.
 *
 * In this project, the React frontend usually runs on one local port
 * (for example Vite on 5173) while Express runs on another (5000).
 *
 * Without CORS, the browser may block frontend requests to the backend.
 */
const cors = require("cors");

/**
 * Import the launcher route module.
 *
 * This route file contains the actual logic for:
 * - starting the VM
 * - stopping the VM
 * - checking VM status
 * - reading guest agent metadata
 */
const launcherRoutes = require("./routes/launcher");

/**
 * Create the Express application instance.
 *
 * Think of this as the backend server object that everything gets attached to.
 */
const app = express();

/**
 * ---------------------------------------------------------------------------
 * MIDDLEWARE
 * ---------------------------------------------------------------------------
 * Middleware runs before route handlers.
 * It helps prepare incoming requests so the app can process them correctly.
 */

/**
 * Enable Cross-Origin Resource Sharing.
 *
 * Why:
 * The frontend and backend are running as separate local services.
 * This allows the browser-based frontend to successfully call the backend API.
 */
app.use(cors());

/**
 * Enable automatic parsing of JSON request bodies.
 *
 * Why:
 * If the frontend sends JSON in a POST request, Express can automatically
 * convert that JSON into req.body.
 *
 * Example:
 * req.body = { someKey: "someValue" }
 */
app.use(express.json());

/**
 * ---------------------------------------------------------------------------
 * ROUTE MOUNTING
 * ---------------------------------------------------------------------------
 * This tells Express which route module should handle which URL prefix.
 */

/**
 * Mount the launcher routes under /api/launcher.
 *
 * This means:
 * - router.post("/start") in launcher.js becomes /api/launcher/start
 * - router.post("/stop") becomes /api/launcher/stop
 * - router.get("/status") becomes /api/launcher/status
 *
 * Why this matters:
 * It keeps route files modular and grouped by responsibility.
 * All launcher-related endpoints live under one clean API namespace.
 */
app.use("/api/launcher", launcherRoutes);

/**
 * ---------------------------------------------------------------------------
 * SERVER STARTUP
 * ---------------------------------------------------------------------------
 */

/**
 * The local port used by the Express backend.
 *
 * The frontend uses this port when calling API endpoints like:
 * http://localhost:5000/api/launcher/status
 */
const PORT = 5000;

/**
 * Start the Express server and begin listening for incoming HTTP requests.
 *
 * Once this is running:
 * - the frontend can call backend endpoints
 * - launcher routes become active
 * - the local API is live
 */
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});