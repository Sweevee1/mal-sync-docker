import type { ListEntry, StatusResponse, SyncRun, SyncRunEntry } from "./types";

export const UNAUTHORIZED_EVENT = "msd:unauthorized";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", "X-MSD-Request": "1", ...init.headers },
    });
  } catch {
    throw new ApiError(0, "Could not reach the server. Check that it is running.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const retryAfter = Number.parseInt(res.headers.get("Retry-After") ?? "", 10);
    // The session endpoints answer 401 for ordinary reasons (wrong password, not signed in yet).
    if (res.status === 401 && !path.startsWith("/session")) {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(
      res.status,
      body.error ?? `The server returned an error (HTTP ${res.status}).`,
      Number.isFinite(retryAfter) ? retryAfter : undefined
    );
  }
  if (res.status === 204 || res.status === 202) return undefined as T;
  return res.json();
}

export const api = {
  getSession: async (): Promise<boolean> => {
    try {
      await request<{ authenticated: boolean }>("/session");
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return false;
      throw err;
    }
  },
  login: (password: string) =>
    request<{ authenticated: true }>("/session/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => request<{ ok: true }>("/session/logout", { method: "POST" }),

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
