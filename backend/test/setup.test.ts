import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Jar, blankEnv, setupTestDb, startServer } from "./helpers";
import type { Client } from "./helpers";

// Zero-variable boot: only DATABASE_URL is set, everything else is generated or chosen in the UI.
blankEnv("ENCRYPTION_KEY", "ADMIN_PASSWORD_HASH", "PUBLIC_BASE_URL", "RESET_ADMIN_PASSWORD");
process.env.TRUST_PROXY = "false";
const db = setupTestDb();

const PASSWORD = "a long enough password";
const NEXT = "another long password";

let t: Client;
let setupCode: string;

before(async () => {
  const { createApp } = await import("../src/app");
  const { initAuth } = await import("../src/auth/session");
  const { ensureSetupCode } = await import("../src/auth/adminCredential");
  await initAuth();
  setupCode = ensureSetupCode();
  t = await startServer(createApp());
});

after(async () => {
  await t.close();
  const { prisma } = await import("../src/db/client");
  await prisma.$disconnect();
  db.cleanup();
});

describe("zero-variable boot", () => {
  it("generated an encryption key file next to the database", () => {
    const file = path.join(db.dir, "encryption.key");
    assert.ok(fs.existsSync(file));
    if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  });

  it("reports setupRequired while unauthenticated and keeps data routes closed", async () => {
    const session = await t.safe("GET", "/api/session");
    assert.equal(session.status, 401);
    assert.equal(session.json.setupRequired, true);
    assert.equal((await t.safe("GET", "/api/entries")).status, 401);
  });

  it("login is refused with 409 until a password exists", async () => {
    const res = await t.safe("POST", "/api/session/login", { body: { password: PASSWORD } });
    assert.equal(res.status, 409);
  });
});

describe("setup", () => {
  it("rejects a wrong setup code", async () => {
    const res = await t.safe("POST", "/api/session/setup", { body: { password: PASSWORD, setupCode: "nope" } });
    assert.equal(res.status, 401);
  });

  it("rejects a password under 12 characters", async () => {
    const res = await t.safe("POST", "/api/session/setup", { body: { password: "short", setupCode } });
    assert.equal(res.status, 400);
  });

  it("rejects extra keys", async () => {
    const res = await t.safe("POST", "/api/session/setup", { body: { password: PASSWORD, setupCode, extra: 1 } });
    assert.equal(res.status, 400);
  });

  it("is throttled like login", async () => {
    const seen: number[] = [];
    for (let i = 0; i < 8; i++) {
      seen.push((await t.safe("POST", "/api/session/setup", { body: { password: PASSWORD, setupCode: `bad${i}` } })).status);
    }
    assert.ok(seen.includes(429), `expected a 429 in ${seen.join(",")}`);
  });
});

// The throttle above used up this client's budget, so the claim runs on a fresh app instance.
describe("claiming and changing the password", () => {
  let t2: Client;
  const jar = new Jar();

  before(async () => {
    const { createApp } = await import("../src/app");
    t2 = await startServer(createApp());
  });
  after(async () => {
    await t2.close();
  });

  it("the correct code sets the password, signs in, and uses plain-http LAN cookies", async () => {
    const res = await t2.safe("POST", "/api/session/setup", { jar, body: { password: PASSWORD, setupCode } });
    assert.equal(res.status, 200);
    const cookie = String(res.headers["set-cookie"]);
    assert.match(cookie, /^msd_session=/);
    assert.doesNotMatch(cookie, /Secure/i);
    assert.doesNotMatch(cookie, /__Host-/);
    const session = await t2.safe("GET", "/api/session", { jar });
    assert.equal(session.status, 200);
    assert.equal(session.json.authenticated, true);
  });

  it("setup is refused forever after the claim", async () => {
    const res = await t2.safe("POST", "/api/session/setup", { body: { password: NEXT, setupCode } });
    assert.equal(res.status, 409);
    assert.equal((await t2.safe("GET", "/api/session")).json.setupRequired, false);
  });

  it("login works with the chosen password and not another", async () => {
    assert.equal((await t2.safe("POST", "/api/session/login", { body: { password: NEXT } })).status, 401);
    assert.equal((await t2.safe("POST", "/api/session/login", { body: { password: PASSWORD } })).status, 200);
  });

  it("change-password needs a session and the current password", async () => {
    assert.equal(
      (await t2.safe("POST", "/api/session/password", { body: { currentPassword: PASSWORD, newPassword: NEXT } })).status,
      401
    );
    const wrong = await t2.safe("POST", "/api/session/password", {
      jar,
      body: { currentPassword: "wrong wrong wrong", newPassword: NEXT },
    });
    assert.equal(wrong.status, 401);
  });

  it("change-password swaps the hash and signs out other sessions", async () => {
    const other = new Jar();
    assert.equal((await t2.safe("POST", "/api/session/login", { jar: other, body: { password: PASSWORD } })).status, 200);
    const res = await t2.safe("POST", "/api/session/password", {
      jar,
      body: { currentPassword: PASSWORD, newPassword: NEXT },
    });
    assert.equal(res.status, 200);
    assert.equal((await t2.safe("GET", "/api/session", { jar })).status, 200);
    assert.equal((await t2.safe("GET", "/api/session", { jar: other })).status, 401);
    assert.equal((await t2.safe("POST", "/api/session/login", { body: { password: PASSWORD } })).status, 401);
    assert.equal((await t2.safe("POST", "/api/session/login", { body: { password: NEXT } })).status, 200);
  });
});

describe("LAN mode (no PUBLIC_BASE_URL)", () => {
  let t3: Client;
  const jar = new Jar();

  before(async () => {
    const { createApp } = await import("../src/app");
    t3 = await startServer(createApp());
    await t3.safe("POST", "/api/session/login", { jar, body: { password: NEXT } });
  });
  after(async () => {
    await t3.close();
  });

  it("CSRF accepts an Origin equal to the request Host and rejects a foreign one", async () => {
    const ok = await t3.safe("PUT", "/api/auth/mal/client", { jar, body: { clientId: "abc" } });
    assert.equal(ok.status, 200);
    const bad = await t3.safe("PUT", "/api/auth/mal/client", {
      jar,
      body: { clientId: "abc" },
      headers: { Origin: "http://evil.example.test" },
    });
    assert.equal(bad.status, 403);
  });

  it("the OAuth start redirect URI is built from the local Host", async () => {
    const res = await t3.safe("GET", "/api/auth/mal/start", { jar });
    assert.equal(res.status, 302);
    const location = String(res.headers.location);
    assert.ok(
      location.includes(encodeURIComponent(`http://127.0.0.1:${t3.port}/api/auth/mal/callback`)),
      `unexpected redirect: ${location}`
    );
  });

  it("status reports the resolved callback base", async () => {
    const res = await t3.safe("GET", "/api/status", { jar });
    assert.equal(res.json.oauthCallbackBase, `http://127.0.0.1:${t3.port}`);
  });
});
