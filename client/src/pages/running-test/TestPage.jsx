import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Navigation from "../../components/Navigation";
import { buildApiUrl, getLauncherStatus } from "../../lib/api";
import "../../TestPage.css";

const MetadataCard = ({ title, children }) => (
  <div className="RunningTest-Card">
    <div className="RunningTest-CardTitle">{title}</div>
    <div className="RunningTest-CardBody">{children}</div>
  </div>
);

const ValueRow = ({ label, value }) => (
  <div className="Value-Row">
    <span className="Value-Label">{label}</span>
    <span className="Value-Data">{value ?? "Not available yet"}</span>
  </div>
);

const TestPage = () => {
  const [statusData, setStatusData] = useState(null);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");

  const fetchStatus = async () => {
    try {
      const data = await getLauncherStatus();
      setStatusData(data);
      setLastUpdated(new Date().toLocaleTimeString());
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load running test data.");
    }
  };

  useEffect(() => {
    fetchStatus();
    const intervalId = setInterval(fetchStatus, 3000);
    return () => clearInterval(intervalId);
  }, []);

  const launchState = statusData?.launchState;
  const agentHeartbeat = statusData?.agentHeartbeat;
  const agentTask = statusData?.agentTask;
  const agentResult = statusData?.agentResult;
  const guestRuntime = statusData?.guestRuntime;
  const guestAgent = statusData?.guestAgent;
  const agentInstallLog = statusData?.agentInstallLog;
  const launchInProgress = statusData?.launchInProgress;
  const resultArtifacts = agentResult?.artifacts
    ? Object.entries(agentResult.artifacts)
        .map(([name, value]) => `${name}: ${value}`)
        .join("\n")
    : "";
  const screenshotUrl = agentResult?.artifactUrls?.screenshot
    ? buildApiUrl(agentResult.artifactUrls.screenshot)
    : "";

  const containerStatus = launchState?.status || "pending";

  const statusClass =
    containerStatus === "running"
      ? "Status-Badge Running"
      : launchInProgress
      ? "Status-Badge Pending"
      : "Status-Badge Waiting";

  const message =
    containerStatus === "running"
      ? "Windows VM launched successfully."
      : launchInProgress
      ? "VM launch in progress."
      : "Waiting for VM launch.";

  return (
    <>
      <Navigation />
      <div className="RunningTest-Page">
        <div className="RunningTest-Box">
          <div className="RunningTest-Header">
            <div>
              <h2 className="RunningTest-Title">Running Test</h2>
              <p className="RunningTest-Subtitle">
                Live launch metadata for the current VM test run
              </p>
            </div>

            <div className="RunningTest-HeaderActions">
              <span className={statusClass}>
                {launchInProgress
                  ? "Launching"
                  : containerStatus === "running"
                  ? "Running"
                  : "Waiting"}
              </span>

              <button className="RunningTest-RefreshButton" onClick={fetchStatus}>
                Refresh
              </button>

              <Link to="/dashboard" className="RunningTest-BackLink">
                Back to Dashboard
              </Link>
            </div>
          </div>

          {error && <p className="RunningTest-Error">{error}</p>}

          <div className="RunningTest-LastUpdated">
            Last updated: {lastUpdated || "Waiting for first refresh"}
          </div>

          <div className="RunningTest-Grid">
            <MetadataCard title="Launch Summary">
              <ValueRow label="Message" value={message} />
              <ValueRow label="Timestamp" value={lastUpdated || null} />
              <ValueRow
                label="Launch In Progress"
                value={launchInProgress ? "Yes" : "No"}
              />
            </MetadataCard>

            <MetadataCard title="Container">
              <ValueRow label="Name" value={launchState?.containerName} />
              <ValueRow label="ID" value="Not exposed yet" />
              <ValueRow label="Status" value={launchState?.status} />
            </MetadataCard>

            <MetadataCard title="Viewer / Connection">
              <ValueRow label="Viewer URL" value={launchState?.webUrl} />
              <ValueRow label="RDP Host" value="127.0.0.1" />
              <ValueRow label="RDP Port" value="3389" />
            </MetadataCard>

            <MetadataCard title="Runtime Files">
              <ValueRow label="Compose File" value={launchState?.composeFile} />
              <ValueRow label="Source" value={launchState?.source} />
            </MetadataCard>

            <MetadataCard title="Agent Heartbeat">
              <ValueRow label="Agent Name" value={agentHeartbeat?.agent?.name} />
              <ValueRow label="Agent Status" value={agentHeartbeat?.agent?.status} />
              <ValueRow label="Agent Version" value={agentHeartbeat?.agent?.version} />
              <ValueRow label="Task Name" value={agentHeartbeat?.agent?.taskName} />
              <ValueRow
                label="Interval (seconds)"
                value={agentHeartbeat?.agent?.intervalSeconds}
              />
            </MetadataCard>

            <MetadataCard title="VM Machine Metadata">
              <ValueRow
                label="Computer Name"
                value={agentHeartbeat?.machine?.computerName}
              />
              <ValueRow label="Username" value={agentHeartbeat?.machine?.username} />
              <ValueRow
                label="Heartbeat Time"
                value={agentHeartbeat?.machine?.timestampUtc}
              />
              <ValueRow
                label="Shared Root"
                value={agentHeartbeat?.machine?.sharedRoot}
              />
            </MetadataCard>

            <MetadataCard title="Queued Task">
              <ValueRow label="Task ID" value={agentTask?.taskId} />
              <ValueRow label="Type" value={agentTask?.taskType} />
              <ValueRow label="Status" value={agentTask?.status} />
              <ValueRow label="Created" value={agentTask?.createdUtc} />
            </MetadataCard>

            <MetadataCard title="Agent Result">
              <ValueRow label="Status" value={agentResult?.status} />
              <ValueRow label="Message" value={agentResult?.message} />
              <ValueRow label="Finished" value={agentResult?.finishedUtc} />
              <ValueRow
                label="Backend"
                value={agentResult?.details?.automationBackend}
              />
            </MetadataCard>

            <MetadataCard title="Guest Runtime">
              <ValueRow label="Synced" value={guestRuntime?.syncedUtc} />
              <ValueRow
                label="Files"
                value={guestRuntime?.files?.join(", ")}
              />
            </MetadataCard>

            <MetadataCard title="Guest Agent Readiness">
              <ValueRow label="State" value={guestAgent?.state} />
              <ValueRow label="Message" value={guestAgent?.message} />
              <ValueRow label="Expected Version" value={guestAgent?.expectedVersion} />
              <ValueRow label="Current Version" value={guestAgent?.currentVersion} />
              <ValueRow
                label="Heartbeat Age"
                value={
                  guestAgent?.heartbeatAgeSeconds === null ||
                  guestAgent?.heartbeatAgeSeconds === undefined
                    ? null
                    : `${guestAgent.heartbeatAgeSeconds}s`
                }
              />
            </MetadataCard>
          </div>

          <MetadataCard title="Prototype Notes">
            {agentHeartbeat?.prototype?.notes?.length ? (
              <ul className="RunningTest-Notes">
                {agentHeartbeat.prototype.notes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            ) : (
              <p className="RunningTest-Placeholder">
                VM launch is working. Waiting for the VM agent to write outward metadata.
              </p>
            )}
          </MetadataCard>

          <MetadataCard title="Agent Install Log">
            <pre className="RunningTest-LogBlock">
              {agentInstallLog || "No install log captured yet."}
            </pre>
          </MetadataCard>

          <MetadataCard title="Latest Screenshot">
            {screenshotUrl ? (
              <div className="RunningTest-ScreenshotFrame">
                <img
                  className="RunningTest-Screenshot"
                  src={screenshotUrl}
                  alt="Latest Windows VM automation screenshot"
                />
                <a
                  className="RunningTest-ScreenshotLink"
                  href={screenshotUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open full size
                </a>
              </div>
            ) : (
              <p className="RunningTest-Placeholder">
                No screenshot artifact has been reported yet.
              </p>
            )}
          </MetadataCard>

          <MetadataCard title="Artifacts">
            <pre className="RunningTest-LogBlock">
              {resultArtifacts || "No artifacts reported yet."}
            </pre>
          </MetadataCard>
        </div>
      </div>
    </>
  );
};

export default TestPage;
