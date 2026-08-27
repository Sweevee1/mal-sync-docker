import type { ServiceStatus } from "../api/types";
import ServiceIcon from "./ServiceIcon";

interface Props {
  name: string;
  icon: "mal" | "anilist" | "kitsu";
  status: ServiceStatus;
  onConnect?: () => void;
  onDisconnect?: () => void;
  connectLabel?: string;
  primary?: boolean;
}

export default function ServiceStatusCard({
  name,
  icon,
  status,
  onConnect,
  onDisconnect,
  connectLabel,
  primary,
}: Props) {
  return (
    <div className="card service-card">
      <div className="service-card-header">
        <div className="service-card-title">
          <ServiceIcon service={icon} />
          <h3>{name}</h3>
        </div>
        <div className="service-card-badges">
          {status.connected ? (
            <span className={status.expired ? "badge badge-warn" : "badge badge-ok"}>
              {status.expired ? "Reconnect needed" : "Connected"}
            </span>
          ) : (
            <span className="badge badge-neutral">Not connected</span>
          )}
          {primary && <span className="badge badge-primary">Primary</span>}
        </div>
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
