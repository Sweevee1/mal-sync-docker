import net from "node:net";
import type { Request } from "express";
import { isHttpsBase } from "../config/env";
import type { Config } from "../config/env";
import { HttpError } from "../http/errors";

export function normalizeIp(ip: string | undefined): string {
  return (ip ?? "").replace(/^::ffff:/i, "");
}

export function isLoopbackOrPrivate(ip: string): boolean {
  if (ip === "::1") return true;
  if (net.isIP(ip) !== 4) return false;
  const [a, b] = ip.split(".").map(Number);
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// Judge by the TCP peer, not req.ip or Forwarded headers, and refuse if the
// peer is a trusted proxy hop: a proxy reporting plain HTTP means the client
// side of that hop is not known to be local.
export function peerIsLocalAndDirect(req: Request): boolean {
  const peer = normalizeIp(req.socket.remoteAddress);
  if (!isLoopbackOrPrivate(peer)) return false;
  const trusted = req.app.get("trust proxy fn") as ((addr: string, i: number) => boolean) | undefined;
  return !(trusted && trusted(req.socket.remoteAddress ?? peer, 0));
}

// Plain HTTP is only acceptable on a LAN-only install (http or unset base URL).
export function connectionAllowedForAuth(cfg: Pick<Config, "PUBLIC_BASE_URL">, req: Request): boolean {
  // With an https PUBLIC_BASE_URL the deployment is public-facing, so there is
  // no plain-HTTP exception; req.secure is only true for a real TLS socket or
  // a trusted proxy's X-Forwarded-Proto.
  if (isHttpsBase(cfg)) return req.secure;
  return req.secure || peerIsLocalAndDirect(req);
}

const LABEL = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?";
const HOST_SHAPE = new RegExp(`^(?:\\d{1,3}(?:\\.\\d{1,3}){3}|${LABEL}(?:\\.${LABEL})*)(?::\\d{1,5})?$`);

// A configured PUBLIC_BASE_URL is used verbatim. Without one ("LAN mode") the
// Host header is trusted only when the TCP peer is local and direct, and only
// in a strict hostname/IPv4[:port] shape, since the result becomes an OAuth
// redirect URI that gets stored.
export function resolveBaseUrl(cfg: Pick<Config, "PUBLIC_BASE_URL">, req: Request): string {
  if (cfg.PUBLIC_BASE_URL) return cfg.PUBLIC_BASE_URL;
  const host = req.get("host");
  if (!host || !HOST_SHAPE.test(host) || !peerIsLocalAndDirect(req)) {
    throw new HttpError(400, "Set PUBLIC_BASE_URL to the address you browse to, then restart.");
  }
  return `http://${host}`;
}

export function tryResolveBaseUrl(cfg: Pick<Config, "PUBLIC_BASE_URL">, req: Request): string | null {
  try {
    return resolveBaseUrl(cfg, req);
  } catch {
    return null;
  }
}
