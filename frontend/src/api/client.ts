import type { ListEntry, StatusResponse, SyncRun, SyncRunEntry } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  if (res.status === 204 || res.status === 202) return undefined as T;
  return res.json();
}

export const api = {
  getStatus: () => request<StatusResponse>("/status"),

  connectKitsu: (username: string, password: string) =>
    request<{ ok: true }>("/auth/kitsu", { method: "POST", body: JSON.stringify({ username, password }) }),
  connectKitsuToken: (accessToken: string, refreshToken: string, expiresInSeconds: number | null) =>
    request<{ ok: true }>("/auth/kitsu/token", {
      method: "POST",
      body: JSON.stringify({ accessToken, refreshToken, expiresInSeconds }),
    }),
  disconnectService: (service: "MAL" | "ANILIST" | "KITSU") =>
    request<{ ok: true }>(`/auth/${service}`, { method: "DELETE" }),
  setMalClient: (clientId: string) =>
    request<{ ok: true }>("/auth/mal/client", { method: "PUT", body: JSON.stringify({ clientId }) }),
  setAnilistClient: (clientId: string, clientSecret: string) =>
    request<{ ok: true }>("/auth/anilist/client", { method: "PUT", body: JSON.stringify({ clientId, clientSecret }) }),

  triggerSync: (dryRun = false) =>
    request<{ ok: true; dryRun: boolean }>("/sync/run", { method: "POST", body: JSON.stringify({ dryRun }) }),
  triggerCheck: () => request<{ ok: true }>("/sync/check", { method: "POST" }),
  getSyncStatus: () => request<{ running: boolean; latest: SyncRun | null }>("/sync/status"),
  getSyncHistory: () => request<{ runs: SyncRun[] }>("/sync/history"),
  getSyncRunDetail: (id: number) => request<{ run: SyncRun & { entries: SyncRunEntry[] } }>(`/sync/history/${id}`),

  getEntries: (params: { type?: string; status?: string; service?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => !!v) as [string, string][]);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<{ entries: ListEntry[] }>(`/entries${suffix}`);
  },
  getPendingDeletions: () => request<{ entries: ListEntry[] }>("/entries/pending-deletions"),
  confirmDeletion: (mediaType: string, malId: number, service: "ANILIST" | "KITSU") =>
    request<{ ok: true }>(`/entries/${mediaType}/${malId}/confirm-deletion?service=${service}`, { method: "POST" }),
  dismissDeletion: (mediaType: string, malId: number, service: "ANILIST" | "KITSU") =>
    request<{ ok: true }>(`/entries/${mediaType}/${malId}/dismiss-deletion?service=${service}`, { method: "POST" }),

  getSettings: () => request<{ settings: { syncIntervalMinutes: number } }>("/settings"),
  updateSettings: (syncIntervalMinutes: number) =>
    request<{ settings: { syncIntervalMinutes: number } }>("/settings", {
      method: "PUT",
      body: JSON.stringify({ syncIntervalMinutes }),
    }),
};
