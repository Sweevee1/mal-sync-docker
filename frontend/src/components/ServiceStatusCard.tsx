import { Link } from "react-router-dom";
import type { ServiceStatus } from "../api/types";
import ServiceIcon from "./ServiceIcon";

interface Props {
  name: string;
  icon: "mal" | "anilist" | "kitsu";
  status: ServiceStatus;
  connectHref?: string;
  connectTo?: string;
  onDisconnect?: () => void;
  connectLabel?: string;
  primary?: boolean;
}

export default function ServiceStatusCard({
  name,
  icon,
  status,
  connectHref,
  connectTo,
  onDisconnect,
  connectLabel,
  primary,
}: Props) {
  const needsConnect = !status.connected || status.expired;
  const label = connectLabel ?? (status.expired ? "Reconnect" : "Connect");
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
          {primary && <span className="badge badge-primary">Source of truth</span>}
        </div>
      </div>
      {status.connected && status.connectedAt && (
        <p className="muted">Connected {new Date(status.connectedAt).toLocaleString()}</p>
      )}
      {!status.connected && !status.clientConfigured && (
        <p className="muted">Add your Client ID on Connect Services first.</p>
      )}
      {needsConnect && status.lastAuthError && (
        <p className="error-detail">Last attempt failed: {status.lastAuthError}</p>
      )}
      <div className="service-card-actions">
        {needsConnect && connectHref && (
          <a className="btn" href={connectHref}>
            {label}
          </a>
        )}
        {needsConnect && connectTo && (
          <Link className="btn" to={connectTo}>
            {label}
          </Link>
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
