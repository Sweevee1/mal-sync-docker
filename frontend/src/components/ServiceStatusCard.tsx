import type { ServiceStatus } from "../api/types";

interface Props {
  name: string;
  status: ServiceStatus;
  onConnect?: () => void;
  onDisconnect?: () => void;
  connectLabel?: string;
}

export default function ServiceStatusCard({ name, status, onConnect, onDisconnect, connectLabel }: Props) {
  return (
    <div className="card service-card">
      <div className="service-card-header">
        <h3>{name}</h3>
        {status.connected ? (
          <span className={status.expired ? "badge badge-warn" : "badge badge-ok"}>
            {status.expired ? "Reconnect needed" : "Connected"}
          </span>
        ) : (
          <span className="badge badge-neutral">Not connected</span>
        )}
      </div>
      {status.connected && status.connectedAt && (
        <p className="muted">Connected {new Date(status.connectedAt).toLocaleString()}</p>
      )}
      <div className="service-card-actions">
        {(!status.connected || status.expired) && onConnect && (
          <button onClick={onConnect}>{connectLabel ?? "Connect"}</button>
        )}
        {status.connected && onDisconnect && (
          <button className="secondary" onClick={onDisconnect}>
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
}
