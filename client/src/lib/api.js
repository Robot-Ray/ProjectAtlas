const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

async function parseJson(response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error || data.message || "Request failed");
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

export async function startLauncher(payload = {}) {
  const response = await fetch(`${API_BASE}/api/launcher/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return parseJson(response);
}

export async function getLauncherStatus() {
  const response = await fetch(`${API_BASE}/api/launcher/status`);
  return parseJson(response);
}

export function buildApiUrl(path) {
  return `${API_BASE}${path}`;
}
