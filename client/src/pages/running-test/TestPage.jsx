import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Navigation from "../../components/Navigation";
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
      const response = await fetch("http://localhost:5000/api/launcher/status");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to load running test data.");
      }

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
  const agentInstallLog = statusData?.agentInstallLog;
  const launchInProgress = statusData?.launchInProgress;

  const containerStatus = launchState?.container?.status || "pending";
  const statusClass =
    containerStatus === "running"
      ? "Status-Badge Running"
      : launchInProgress
      ? "Status-Badge Pending"
      : "Status-Badge Waiting";

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
              <ValueRow label="Message" value={launchState?.message} />
              <ValueRow label="Timestamp" value={launchState?.timestampUtc} />
              <ValueRow label="Launch In Progress" value={launchInProgress ? "Yes" : "No"} />
            </MetadataCard>

            <MetadataCard title="Container">
              <ValueRow label="Name" value={launchState?.container?.name} />
              <ValueRow label="ID" value={launchState?.container?.id} />
              <ValueRow label="Status" value={launchState?.container?.status} />
            </MetadataCard>

            <MetadataCard title="Viewer / Connection">
              <ValueRow label="Viewer URL" value={launchState?.endpoints?.viewerUrl} />
              <ValueRow label="RDP Host" value={launchState?.endpoints?.rdpHost} />
              <ValueRow label="RDP Port" value={launchState?.endpoints?.rdpPort} />
            </MetadataCard>

            <MetadataCard title="Runtime Files">
              <ValueRow label="Shared Path" value={launchState?.paths?.shared} />
              <ValueRow label="State File" value={launchState?.paths?.stateFile} />
            </MetadataCard>

            <MetadataCard title="Agent Heartbeat">
              <ValueRow label="Agent Name" value={agentHeartbeat?.agent?.name} />
              <ValueRow label="Agent Status" value={agentHeartbeat?.agent?.status} />
              <ValueRow label="Task Name" value={agentHeartbeat?.agent?.taskName} />
              <ValueRow label="Interval (minutes)" value={agentHeartbeat?.agent?.intervalMinutes} />
            </MetadataCard>

            <MetadataCard title="VM Machine Metadata">
              <ValueRow label="Computer Name" value={agentHeartbeat?.machine?.computerName} />
              <ValueRow label="Username" value={agentHeartbeat?.machine?.username} />
              <ValueRow label="Heartbeat Time" value={agentHeartbeat?.machine?.timestampUtc} />
              <ValueRow label="Shared Root" value={agentHeartbeat?.machine?.sharedRoot} />
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
                Waiting for the VM agent to write outward metadata.
              </p>
            )}
          </MetadataCard>

          <MetadataCard title="Agent Install Log">
            <pre className="RunningTest-LogBlock">
              {agentInstallLog || "No install log captured yet."}
            </pre>
          </MetadataCard>
        </div>
      </div>
    </>
  );
};

export default TestPage;