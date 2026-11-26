import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";

const PASSWORD = "correct horse battery staple";
const PUBLIC_BASE = "http://msd.example.test";
const HTTPS_BASE = "https://msd.example.test";

function makeScryptHash(password: string): string {
  const N = 16384;
  const r = 8;
  const p = 1;
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N, r, p });
  return `scrypt:${N}:${r}:${p}:${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msd-test-"));
const dbFile = path.join(tmpDir, "test.db").replace(/\\/g, "/");

process.env.DATABASE_URL = `file:${dbFile}`;
process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
process.env.PUBLIC_BASE_URL = PUBLIC_BASE;
process.env.ADMIN_PASSWORD_HASH = makeScryptHash(PASSWORD);
process.env.TRUST_PROXY = "false";

const backendDir = path.resolve(__dirname, "..");
const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  cwd: backendDir,
  env: process.env,
  shell: true,
  encoding: "utf8",
});
if (migrate.status !== 0) {
  throw new Error(`prisma migrate deploy failed:\n${migrate.stdout}\n${migrate.stderr}`);
}

// PUT /api/settings arms the sync scheduler's interval; unref it so the test
// process can exit.
const realSetInterval = global.setInterval;
global.setInterval = ((...args: Parameters<typeof setInterval>) => {
  const handle = realSetInterval(...args);
  handle.unref();
  return handle;
}) as typeof setInterval;

// Express 4 does not catch rejected async handlers; keep the process alive so
// the robustness tests can report on it instead of the runner dying.
const unhandled: unknown[] = [];
process.on("unhandledRejection", (reason) => {
  unhandled.push(reason);
});

type Res = { status: number; headers: http.IncomingHttpHeaders; body: string; json: any };
type ReqOpts = {
  headers?: Record<string, string>;
  body?: unknown;
  rawBody?: string;
  jar?: Jar;
  timeoutMs?: number;
};

class Jar {
  cookies = new Map<string, string>();
  absorb(setCookie: string[] | undefined) {
    for (const line of setCookie ?? []) {
      const [pair, ...attrs] = line.split(";");
      const idx = pair.indexOf("=");
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === "";
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

function rawRequest(port: number, method: string, urlPath: string, opts: ReqOpts = {}): Promise<Res> {
  return new Promise((resolve) => {
    const headers: Record<string, string> = { Connection: "close", ...(opts.headers ?? {}) };
    let payload: string | undefined = opts.rawBody;
    if (payload === undefined && opts.body !== undefined) {
      payload = JSON.stringify(opts.body);
    }
    if (payload !== undefined) {
      headers["Content-Type"] ??= "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(payload));
    }
    const cookie = opts.jar?.header();
    if (cookie) headers["Cookie"] = cookie;

    const req = http.request(
      { host: "127.0.0.1", port, method, path: urlPath, headers, agent: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          opts.jar?.absorb(res.headers["set-cookie"]);
          const body = Buffer.concat(chunks).toString("utf8");
          let json: any = undefined;
          try {
            json = JSON.parse(body);
          } catch {
            // not JSON
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body, json });
        });
      }
    );
    req.setTimeout(opts.timeoutMs ?? 3000, () => {
      req.destroy();
      resolve({ status: 0, headers: {}, body: "", json: undefined });
    });
    req.on("error", () => resolve({ status: 0, headers: {}, body: "", json: undefined }));
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

type TestApp = {
  port: number;
  origin: string;
  close: () => Promise<void>;
  req: (method: string, urlPath: string, opts?: ReqOpts) => Promise<Res>;
  /** Request carrying Origin + X-MSD-Request, as the real frontend would send. */
  safe: (method: string, urlPath: string, opts?: ReqOpts) => Promise<Res>;
  login: (jar: Jar, password?: string) => Promise<Res>;
};

async function startApp(overrides: Record<string, unknown> = {}): Promise<TestApp> {
  const { createApp } = await import("../src/app");
  const app = createApp(overrides as any);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;

  const req: TestApp["req"] = (method, urlPath, opts) => rawRequest(port, method, urlPath, opts);
  const safe: TestApp["safe"] = (method, urlPath, opts = {}) =>
    rawRequest(port, method, urlPath, {
      ...opts,
      headers: { Origin: origin, "X-MSD-Request": "1", ...(opts.headers ?? {}) },
    });
  const login: TestApp["login"] = (jar, password = PASSWORD) =>
    safe("POST", "/api/session/login", { jar, body: { password } });

  return {
    port,
    origin,
    req,
    safe,
    login,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

async function prismaClient() {
  const { prisma } = await import("../src/db/client");
  return prisma;
}

after(async () => {
  const prisma = await prismaClient();
  await prisma.$disconnect();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("authentication gate", () => {
  let t: TestApp;
  before(async () => {
    t = await startApp();
  });
  after(async () => {
    await t.close();
  });

  const protectedRoutes: Array<[string, string]> = [
    ["GET", "/api/status"],
    ["GET", "/api/entries"],
    ["GET", "/api/entries/pending-deletions"],
    ["GET", "/api/settings"],
    ["PUT", "/api/settings"],
    ["POST", "/api/sync/run"],
    ["POST", "/api/sync/check"],
    ["GET", "/api/sync/status"],
    ["GET", "/api/sync/history"],
    ["GET", "/api/sync/history/1"],
    ["PUT", "/api/auth/mal/client"],
    ["PUT", "/api/auth/anilist/client"],
    ["GET", "/api/auth/mal/start"],
    ["DELETE", "/api/auth/KITSU"],
    ["POST", "/api/auth/kitsu/token"],
    ["POST", "/api/entries/ANIME/1/confirm-deletion?service=KITSU"],
  ];

  for (const [method, route] of protectedRoutes) {
    it(`${method} ${route} returns 401 without a session`, async () => {
      const body = method === "GET" ? undefined : {};
      const res = await t.safe(method, route, { body });
      assert.equal(res.status, 401);
    });
  }

  it("GET /api/session returns 401 without a cookie", async () => {
    const res = await t.req("GET", "/api/session");
    assert.equal(res.status, 401);
  });

  it("GET /api/health returns exactly {ok:true} without a session", async () => {
    const res = await t.req("GET", "/api/health");
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { ok: true });
  });
});

describe("login throttle", () => {
  let t: TestApp;
  before(async () => {
    t = await startApp();
  });
  after(async () => {
    await t.close();
  });

  it("returns 429 with Retry-After on the 6th bad attempt", async () => {
    const statuses: number[] = [];
    let last: Res | undefined;
    for (let i = 0; i < 6; i++) {
      last = await t.login(new Jar(), `wrong-${i}`);
      statuses.push(last.status);
    }
    assert.deepEqual(statuses.slice(0, 5), [401, 401, 401, 401, 401]);
    assert.equal(statuses[5], 429);
    assert.ok(last!.headers["retry-after"], "Retry-After header missing");
  });
});

describe("login throttle under concurrency", () => {
  let t: TestApp;
  let burst401 = 0;
  before(async () => {
    t = await startApp();
  });
  after(async () => {
    await t.close();
  });

  it("50 parallel wrong passwords from one IP yield at most 5 x 401 and the rest 429", async () => {
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) => t.login(new Jar(), `wrong-${i}`)));
    const n401 = results.filter((r) => r.status === 401).length;
    const n429 = results.filter((r) => r.status === 429).length;
    burst401 = n401;
    assert.ok(n401 <= 5, `${n401} guesses were verified`);
    assert.equal(n401 + n429, 50, `unexpected statuses: ${results.map((r) => r.status).join(",")}`);
    assert.ok(results.filter((r) => r.status === 429).every((r) => r.headers["retry-after"]));
  });

  it("verified guesses from the burst count toward the same per-IP limit", async () => {
    let verified = burst401;
    for (let i = 0; i < 10; i++) {
      if ((await t.login(new Jar(), `later-${i}`)).status === 401) verified++;
    }
    assert.ok(verified <= 5, `${verified} guesses were verified in total`);
  });
});

describe("login throttle refunds successful logins", () => {
  let t: TestApp;
  before(async () => {
    t = await startApp();
  });
  after(async () => {
    await t.close();
  });

  it("ten correct logins in a row never trip the limiter", async () => {
    for (let i = 0; i < 10; i++) {
      assert.equal((await t.login(new Jar())).status, 200);
    }
  });
});

describe("session and CSRF", () => {
  let t: TestApp;
  const jar = new Jar();
  before(async () => {
    t = await startApp();
  });
  after(async () => {
    await t.close();
  });

  it("rejects a wrong password with 401", async () => {
    const res = await t.login(new Jar(), "not the password");
    assert.equal(res.status, 401);
  });

  it("accepts the correct password and sets an HttpOnly SameSite=Strict msd_session cookie", async () => {
    const res = await t.login(jar);
    assert.equal(res.status, 200);
    const setCookie = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
    const line = setCookie.find((c) => c.startsWith("msd_session="));
    assert.ok(line, "msd_session cookie not set");
    assert.match(line!, /;\s*HttpOnly/i);
    assert.match(line!, /;\s*SameSite=Strict/i);
  });

  it("GET /api/session returns {authenticated:true} with the cookie", async () => {
    const res = await t.req("GET", "/api/session", { jar });
    assert.equal(res.status, 200);
    assert.equal(res.json?.authenticated, true);
  });

  const mutate = (headers: Record<string, string>) =>
    t.req("PUT", "/api/settings", { jar, headers, body: { syncIntervalMinutes: 60 } });

  it("mutating request without Origin returns 403", async () => {
    const res = await mutate({ "X-MSD-Request": "1" });
    assert.equal(res.status, 403);
  });

  it("mutating request with a foreign Origin returns 403", async () => {
    const res = await mutate({ Origin: "https://evil.test", "X-MSD-Request": "1" });
    assert.equal(res.status, 403);
  });

  it("mutating request without X-MSD-Request returns 403", async () => {
    const res = await mutate({ Origin: t.origin });
    assert.equal(res.status, 403);
  });

  it("mutating request with Origin and X-MSD-Request passes auth", async () => {
    const res = await mutate({ Origin: t.origin, "X-MSD-Request": "1" });
    assert.notEqual(res.status, 401);
    assert.notEqual(res.status, 403);
  });

  it("logout invalidates the session", async () => {
    const own = new Jar();
    assert.equal((await t.login(own)).status, 200);
    assert.equal((await t.req("GET", "/api/settings", { jar: own })).status, 200);
    const stale = new Jar();
    stale.cookies = new Map(own.cookies);
    const out = await t.safe("POST", "/api/session/logout", { jar: own });
    assert.equal(out.status, 200);
    const after = await t.req("GET", "/api/settings", { jar: stale });
    assert.equal(after.status, 401);
  });
});

describe("untrusted proxy headers and Host spoofing", () => {
  let t: TestApp;
  const jar = new Jar();
  before(async () => {
    t = await startApp();
  });
  after(async () => {
    await t.close();
  });

  it("X-Forwarded-Proto does not add Secure to the login cookie", async () => {
    const res = await t.safe("POST", "/api/session/login", {
      jar,
      headers: { "X-Forwarded-Proto": "https" },
      body: { password: PASSWORD },
    });
    assert.equal(res.status, 200);
    const setCookie = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
    const line = setCookie.find((c) => c.startsWith("msd_session="));
    assert.ok(line, "msd_session cookie not set");
    assert.doesNotMatch(line!, /;\s*Secure/i);
  });

  it("X-Forwarded-Proto does not unlock Kitsu password login", async () => {
    const res = await t.safe("POST", "/api/auth/kitsu", {
      jar,
      headers: { "X-Forwarded-Proto": "https" },
      body: { username: "u", password: "p" },
    });
    assert.equal(res.status, 403);
  });

  it("a spoofed Host header does not change the MAL redirect_uri", async () => {
    const set = await t.safe("PUT", "/api/auth/mal/client", { jar, body: { clientId: "test-client-id" } });
    assert.equal(set.status, 200);

    const res = await t.req("GET", "/api/auth/mal/start", { jar, headers: { Host: "evil.test" } });
    assert.ok(res.status >= 300 && res.status < 400, `expected redirect, got ${res.status}`);
    const location = res.headers.location;
    assert.ok(location, "no Location header");
    const redirectUri = new URL(location!).searchParams.get("redirect_uri");
    assert.ok(redirectUri, "no redirect_uri in Location");
    assert.ok(redirectUri!.startsWith(PUBLIC_BASE), `redirect_uri was ${redirectUri}`);
  });
});

describe("OAuth callback state handling", () => {
  let t: TestApp;
  const jar = new Jar();
  before(async () => {
    t = await startApp();
    assert.equal((await t.login(jar)).status, 200);
    assert.equal((await t.safe("PUT", "/api/auth/mal/client", { jar, body: { clientId: "test-client-id" } })).status, 200);
  });
  after(async () => {
    mock.restoreAll();
    await t.close();
  });

  async function startFlow(): Promise<{ state: string; oauth: Jar }> {
    const sessionOnly = new Jar();
    sessionOnly.cookies.set("msd_session", jar.cookies.get("msd_session")!);
    const start = await t.req("GET", "/api/auth/mal/start", { jar: sessionOnly });
    assert.ok(start.status >= 300 && start.status < 400, `start returned ${start.status}`);
    const oauth = new Jar();
    oauth.cookies.set("msd_oauth", sessionOnly.cookies.get("msd_oauth")!);
    assert.ok(oauth.cookies.get("msd_oauth"), "msd_oauth cookie not set");
    return { state: oauth.cookies.get("msd_oauth")!, oauth };
  }

  async function storedCred() {
    const prisma = await prismaClient();
    return prisma.serviceCredential.findUnique({ where: { service: "MAL" } });
  }

  async function stubTokenExchange() {
    // require, not import(): the service modules load the CJS build, and the
    // mock has to land on that same instance.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const axios = require("axios");
    const post = mock.method(axios, "post", async () => ({
      data: { access_token: "at", refresh_token: "rt", expires_in: 3600 },
    }));
    const get = mock.method(axios, "get", async () => ({ data: { name: "tester" } }));
    return { post, get };
  }

  it("callback without the msd_oauth cookie redirects to /?error=state_invalid", async () => {
    const res = await t.req("GET", "/api/auth/mal/callback?code=x&state=y");
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, "/?error=state_invalid");
  });

  it("callback with a stale or mismatched state is rejected the same way", async () => {
    const { oauth } = await startFlow();
    const res = await t.req("GET", "/api/auth/mal/callback?code=x&state=stale-state", { jar: oauth });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, "/?error=state_invalid");
  });

  it("callback never reflects arbitrary text in the redirect", async () => {
    const res = await t.req("GET", "/api/auth/anilist/callback?code=x&state=%3Cscript%3E");
    assert.equal(res.status, 302);
    assert.match(String(res.headers.location), /^\/\?error=[a-z_]+$/);
  });

  it("an unauthenticated callback with no or a wrong cookie does not abort the stored handshake", async () => {
    const { state, oauth } = await startFlow();
    const before = await storedCred();
    assert.ok(before?.oauthState && before.codeVerifier, "handshake not stored");

    const noCookie = await t.req("GET", `/api/auth/mal/callback?code=x&state=${state}`);
    assert.equal(noCookie.headers.location, "/?error=state_invalid");
    const wrong = new Jar();
    wrong.cookies.set("msd_oauth", "not-the-state");
    const wrongCookie = await t.req("GET", `/api/auth/mal/callback?code=x&state=${state}`, { jar: wrong });
    assert.equal(wrongCookie.headers.location, "/?error=state_invalid");

    const after = await storedCred();
    assert.equal(after?.oauthState, before.oauthState);
    assert.equal(after?.codeVerifier, before.codeVerifier);

    const { post, get } = await stubTokenExchange();
    const real = await t.req("GET", `/api/auth/mal/callback?code=real-code&state=${state}`, { jar: oauth });
    assert.equal(real.headers.location, "/?connected=mal");
    assert.equal(post.mock.callCount(), 1);
    assert.equal(get.mock.callCount(), 1);
    const done = await storedCred();
    assert.ok(done?.accessTokenEnc, "token was not stored");
    assert.equal(done?.oauthState, null);
    mock.restoreAll();
  });

  it("a replayed callback is rejected once the handshake is spent", async () => {
    const { state, oauth } = await startFlow();
    await stubTokenExchange();
    const first = await t.req("GET", `/api/auth/mal/callback?code=c&state=${state}`, { jar: oauth });
    assert.equal(first.headers.location, "/?connected=mal");
    const replay = new Jar();
    replay.cookies.set("msd_oauth", state);
    const second = await t.req("GET", `/api/auth/mal/callback?code=c&state=${state}`, { jar: replay });
    assert.equal(second.headers.location, "/?error=state_invalid");
    mock.restoreAll();
  });

  it("an expired stored state is rejected even with a matching cookie", async () => {
    const { state, oauth } = await startFlow();
    const prisma = await prismaClient();
    await prisma.serviceCredential.update({
      where: { service: "MAL" },
      data: { oauthStateExpiresAt: new Date(Date.now() - 1000) },
    });
    const { post } = await stubTokenExchange();
    const res = await t.req("GET", `/api/auth/mal/callback?code=x&state=${state}`, { jar: oauth });
    assert.equal(res.headers.location, "/?error=state_invalid");
    assert.equal(post.mock.callCount(), 0, "token exchange ran despite an expired state");
    mock.restoreAll();
  });

  it("a tampered stored state hash is rejected even with a matching cookie", async () => {
    const { state, oauth } = await startFlow();
    const prisma = await prismaClient();
    await prisma.serviceCredential.update({
      where: { service: "MAL" },
      data: { oauthState: crypto.createHash("sha256").update("other").digest("hex") },
    });
    const { post } = await stubTokenExchange();
    const res = await t.req("GET", `/api/auth/mal/callback?code=x&state=${state}`, { jar: oauth });
    assert.equal(res.headers.location, "/?error=state_invalid");
    assert.equal(post.mock.callCount(), 0, "token exchange ran despite a tampered state");
    mock.restoreAll();
  });
});

describe("path variants never expose data without a session", () => {
  let t: TestApp;
  before(async () => {
    t = await startApp();
  });
  after(async () => {
    await t.close();
  });

  for (const route of ["/API/entries", "/api/./entries", "/api//entries", "/api/%2e/entries", "/api/entries/", "//api/entries"]) {
    it(`GET ${route} without a cookie returns no JSON data`, async () => {
      const res = await t.req("GET", route);
      assert.notEqual(res.status, 0, "request failed");
      assert.equal(res.json?.entries, undefined, "entries were served");
      assert.doesNotMatch(res.body, /"entries"|"total"/);
    });
  }
});

describe("robustness", () => {
  let t: TestApp;
  const jar = new Jar();
  before(async () => {
    t = await startApp();
    assert.equal((await t.login(jar)).status, 200);
  });
  after(async () => {
    await t.close();
  });

  it("GET /api/sync/history/abc returns 400", async () => {
    const res = await t.safe("GET", "/api/sync/history/abc", { jar });
    assert.equal(res.status, 400);
  });

  it("confirm-deletion with a non-numeric malId returns 400", async () => {
    const res = await t.safe("POST", "/api/entries/ANIME/abc/confirm-deletion?service=KITSU", { jar });
    assert.equal(res.status, 400);
  });

  it("confirm-deletion with an out-of-range malId does not hang or leak Prisma errors", async () => {
    const res = await t.safe("POST", "/api/entries/ANIME/99999999999999999999/confirm-deletion?service=KITSU", { jar });
    assert.notEqual(res.status, 0, "request hung or connection dropped");
    assert.ok(res.status >= 400 && res.status < 500, `expected 4xx, got ${res.status}`);
    assert.doesNotMatch(res.body, /prisma/i);
  });

  it("GET /api/entries?status[x]=y returns 400", async () => {
    const res = await t.safe("GET", "/api/entries?status[x]=y", { jar });
    assert.equal(res.status, 400);
  });

  it("PUT /api/settings rejects fractional and oversized intervals and accepts 60", async () => {
    const frac = await t.safe("PUT", "/api/settings", { jar, body: { syncIntervalMinutes: 1.5 } });
    assert.equal(frac.status, 400);
    const big = await t.safe("PUT", "/api/settings", { jar, body: { syncIntervalMinutes: 99999 } });
    assert.equal(big.status, 400);
    const ok = await t.safe("PUT", "/api/settings", { jar, body: { syncIntervalMinutes: 60 } });
    assert.equal(ok.status, 200);
  });

  it("no unhandled rejections escaped and the process still serves /api/health", async () => {
    const res = await t.req("GET", "/api/health");
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { ok: true });
    assert.equal(unhandled.length, 0, `${unhandled.length} unhandled rejection(s) escaped route handlers`);
  });
});

describe("state checks", () => {
  let t: TestApp;
  const jar = new Jar();
  before(async () => {
    t = await startApp();
    assert.equal((await t.login(jar)).status, 200);
  });
  after(async () => {
    await t.close();
  });

  it("confirm-deletion on an entry that is not PENDING_DELETION returns 409", async () => {
    const prisma = await prismaClient();
    await prisma.listEntry.create({
      data: {
        malId: 4242,
        mediaType: "ANIME",
        title: "Test Entry",
        status: "completed",
        score: 8,
        progress: 12,
        malUpdatedAt: new Date(),
        kitsuSyncStatus: "SYNCED",
        kitsuLibraryEntryId: "12345",
      },
    });
    const res = await t.safe("POST", "/api/entries/ANIME/4242/confirm-deletion?service=KITSU", { jar });
    assert.equal(res.status, 409);
    const after = await prisma.listEntry.findUnique({
      where: { malId_mediaType: { malId: 4242, mediaType: "ANIME" } },
    });
    assert.equal(after?.kitsuLibraryEntryId, "12345");
  });

  it("a real 5xx from a failing Prisma call returns exactly {error:'Internal error'}", async () => {
    const prisma = await prismaClient();
    const leak = "PrismaClientKnownRequestError: Invalid `prisma.listEntry.findMany()` invocation in C:\secret\path";
    // The client exposes models lazily, so swap the whole model rather than
    // patching one method on it.
    const original = (prisma as any).listEntry;
    let hits = 0;
    Object.defineProperty(prisma, "listEntry", {
      configurable: true,
      value: {
        findMany: async () => {
          hits++;
          throw new Error(leak);
        },
      },
    });
    const errLog = mock.method(console, "error", () => {});
    try {
      const res = await t.safe("GET", "/api/entries?type=ANIME", { jar });
      assert.ok(hits > 0, "stub was never hit, so no 5xx was forced");
      assert.equal(res.status, 500);
      assert.deepEqual(res.json, { error: "Internal error" });
      assert.doesNotMatch(res.body, /prisma|secret/i);
    } finally {
      errLog.mock.restore();
      Object.defineProperty(prisma, "listEntry", { configurable: true, writable: true, value: original });
    }
  });
});

describe("response headers and body limits", () => {
  let t: TestApp;
  const jar = new Jar();
  before(async () => {
    t = await startApp();
    assert.equal((await t.login(jar)).status, 200);
  });
  after(async () => {
    await t.close();
  });

  it("does not send X-Powered-By", async () => {
    const res = await t.req("GET", "/api/health");
    assert.equal(res.headers["x-powered-by"], undefined);
  });

  it("sends a CSP with default-src 'self' and nosniff", async () => {
    const res = await t.req("GET", "/api/health");
    const csp = String(res.headers["content-security-policy"] ?? "");
    assert.match(csp, /default-src 'self'/);
    assert.equal(res.headers["x-content-type-options"], "nosniff");
  });

  it("rejects request bodies larger than 16kb with 413", async () => {
    const res = await t.safe("PUT", "/api/auth/mal/client", {
      jar,
      body: { clientId: "a".repeat(20 * 1024) },
    });
    assert.equal(res.status, 413);
  });
});

function setCookieLine(res: Res, name: string): string | undefined {
  return ([] as string[]).concat(res.headers["set-cookie"] ?? []).find((c) => c.startsWith(`${name}=`));
}

async function sessionJarFor(cookieName: string): Promise<Jar> {
  const { createSession } = await import("../src/auth/session");
  const jar = new Jar();
  jar.cookies.set(cookieName, await createSession());
  return jar;
}

const xff = (ip: string, proto = "https") => ({ "X-Forwarded-For": ip, "X-Forwarded-Proto": proto });

describe("PUBLIC_BASE_URL https without TRUST_PROXY", () => {
  let t: TestApp;
  before(async () => {
    t = await startApp({ PUBLIC_BASE_URL: HTTPS_BASE, TRUST_PROXY: false });
  });
  after(async () => {
    await t.close();
  });

  it("rejects login with 403 even from loopback and even with a forged X-Forwarded-Proto", async () => {
    const plain = await t.login(new Jar());
    assert.equal(plain.status, 403);
    assert.deepEqual(plain.json, { error: "HTTPS required" });
    const forged = await t.safe("POST", "/api/session/login", {
      headers: xff("198.51.100.9"),
      body: { password: PASSWORD },
    });
    assert.equal(forged.status, 403);
  });
});

describe("PUBLIC_BASE_URL https with a trusted proxy peer", () => {
  let t: TestApp;
  const jar = new Jar();
  before(async () => {
    t = await startApp({ PUBLIC_BASE_URL: HTTPS_BASE, TRUST_PROXY: true, TRUST_PROXY_CIDRS: ["loopback"] });
  });
  after(async () => {
    await t.close();
  });

  const login = (ip: string, password = PASSWORD, j = new Jar()) =>
    t.safe("POST", "/api/session/login", { jar: j, headers: xff(ip), body: { password } });

  it("login with X-Forwarded-Proto https succeeds and sets a __Host- Secure cookie", async () => {
    const res = await login("198.51.100.1", PASSWORD, jar);
    assert.equal(res.status, 200);
    const line = setCookieLine(res, "__Host-msd_session");
    assert.ok(line, `no __Host-msd_session cookie in ${JSON.stringify(res.headers["set-cookie"])}`);
    assert.match(line!, /;\s*Secure/i);
    assert.match(line!, /;\s*Path=\/(;|$)/i);
    assert.match(line!, /;\s*HttpOnly/i);
    assert.doesNotMatch(line!, /;\s*Domain=/i);
    assert.equal(setCookieLine(res, "msd_session"), undefined);
  });

  it("login without X-Forwarded-Proto is rejected with 403 HTTPS required", async () => {
    const res = await t.safe("POST", "/api/session/login", {
      headers: { "X-Forwarded-For": "198.51.100.2" },
      body: { password: PASSWORD },
    });
    assert.equal(res.status, 403);
    assert.deepEqual(res.json, { error: "HTTPS required" });
  });

  it("the session cookie authenticates later requests", async () => {
    const res = await t.req("GET", "/api/session", { jar });
    assert.equal(res.status, 200);
  });

  it("the OAuth start cookie uses the __Host- prefix with Path=/ and Secure", async () => {
    assert.equal((await t.safe("PUT", "/api/auth/mal/client", { jar, body: { clientId: "cid" } })).status, 200);
    const res = await t.req("GET", "/api/auth/mal/start", { jar, headers: xff("198.51.100.1") });
    const line = setCookieLine(res, "__Host-msd_oauth");
    assert.ok(line, `no __Host-msd_oauth cookie in ${JSON.stringify(res.headers["set-cookie"])}`);
    assert.match(line!, /;\s*Secure/i);
    assert.match(line!, /;\s*Path=\/(;|$)/i);
    assert.match(line!, /;\s*SameSite=Lax/i);
  });

  it("separate real client IPs behind the proxy get separate throttle buckets", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await login("203.0.113.50", `bad-${i}`)).status);
    assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
    assert.equal((await login("203.0.113.51", "bad")).status, 401);
    assert.equal((await login("203.0.113.52", PASSWORD)).status, 200);
  });

  it("failures from many IPs never lock out the owner (no global cap)", async () => {
    for (let i = 0; i < 35; i++) {
      assert.equal((await login(`198.18.0.${i + 1}`, "bad")).status, 401);
    }
    assert.equal((await login("198.18.1.1", PASSWORD)).status, 200);
  });

  it("accepts an Origin matching PUBLIC_BASE_URL even when Host differs, and still rejects foreign origins", async () => {
    const put = (origin: string) =>
      t.req("PUT", "/api/settings", {
        jar,
        headers: { Origin: origin, "X-MSD-Request": "1", Host: "internal.proxy.local" },
        body: { syncIntervalMinutes: 60 },
      });
    assert.equal((await put(HTTPS_BASE)).status, 200);
    assert.equal((await put("https://evil.test")).status, 403);
  });

  it("still accepts an Origin matching the request Host", async () => {
    const res = await t.safe("PUT", "/api/settings", { jar, body: { syncIntervalMinutes: 60 } });
    assert.equal(res.status, 200);
  });
});

describe("PUBLIC_BASE_URL https with an untrusted peer forging proxy headers", () => {
  let t: TestApp;
  before(async () => {
    t = await startApp({ PUBLIC_BASE_URL: HTTPS_BASE, TRUST_PROXY: true, TRUST_PROXY_CIDRS: ["203.0.113.0/24"] });
  });
  after(async () => {
    await t.close();
  });

  it("login with a forged X-Forwarded-Proto is rejected with 403", async () => {
    const res = await t.safe("POST", "/api/session/login", {
      headers: xff("198.51.100.1"),
      body: { password: PASSWORD },
    });
    assert.equal(res.status, 403);
    assert.deepEqual(res.json, { error: "HTTPS required" });
  });

  it("the Kitsu password route is 403 with a forged X-Forwarded-Proto", async () => {
    const jar = await sessionJarFor("__Host-msd_session");
    assert.equal((await t.req("GET", "/api/session", { jar })).status, 200);
    const res = await t.safe("POST", "/api/auth/kitsu", {
      jar,
      headers: xff("198.51.100.1"),
      body: { username: "u", password: "p" },
    });
    assert.equal(res.status, 403);
  });
});

describe("plain-HTTP PUBLIC_BASE_URL with an untrusted peer forging X-Forwarded-For", () => {
  let t: TestApp;
  before(async () => {
    t = await startApp({ TRUST_PROXY: true, TRUST_PROXY_CIDRS: ["203.0.113.0/24"] });
  });
  after(async () => {
    await t.close();
  });

  it("rotating X-Forwarded-For does not change the throttle bucket", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await t.safe("POST", "/api/session/login", {
        headers: { "X-Forwarded-For": `198.51.100.${i + 1}` },
        body: { password: `bad-${i}` },
      });
      statuses.push(res.status);
    }
    assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
  });
});

describe("plain-HTTP PUBLIC_BASE_URL behind a trusted proxy hop", () => {
  let t: TestApp;
  before(async () => {
    t = await startApp({ TRUST_PROXY: true, TRUST_PROXY_CIDRS: ["loopback"] });
  });
  after(async () => {
    await t.close();
  });

  it("refuses the plain-HTTP allowance when the loopback peer is a trusted proxy reporting http", async () => {
    const res = await t.safe("POST", "/api/session/login", {
      headers: { "X-Forwarded-For": "198.51.100.1", "X-Forwarded-Proto": "http" },
      body: { password: PASSWORD },
    });
    assert.equal(res.status, 403);
  });
});

describe("startup warnings", () => {
  it("warns when PUBLIC_BASE_URL is https and TRUST_PROXY is false, without secrets", async () => {
    const { startupWarnings } = await import("../src/config/env");
    const warnings = startupWarnings({ PUBLIC_BASE_URL: HTTPS_BASE, TRUST_PROXY: false } as any);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /TRUST_PROXY_CIDRS/);
    assert.doesNotMatch(warnings[0], /scrypt|ENCRYPTION/);
    assert.deepEqual(startupWarnings({ PUBLIC_BASE_URL: HTTPS_BASE, TRUST_PROXY: true } as any), []);
    assert.deepEqual(startupWarnings({ PUBLIC_BASE_URL: PUBLIC_BASE, TRUST_PROXY: false } as any), []);
  });
});
