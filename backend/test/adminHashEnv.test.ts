import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { blankEnv, makeScryptHash, setupTestDb, startServer } from "./helpers";
import type { Client } from "./helpers";

// ADMIN_PASSWORD_HASH set: it wins, it is mirrored into the DB, and the DB copy
// keeps working after the variable is removed (a later boot without it).
const PASSWORD = "env supplied password";
blankEnv("ENCRYPTION_KEY", "PUBLIC_BASE_URL", "RESET_ADMIN_PASSWORD");
process.env.ADMIN_PASSWORD_HASH = makeScryptHash(PASSWORD);
const db = setupTestDb();

let t: Client;

before(async () => {
  const { createApp } = await import("../src/app");
  const { initAuth } = await import("../src/auth/session");
  await initAuth();
  t = await startServer(createApp());
});
after(async () => {
  await t.close();
  const { prisma } = await import("../src/db/client");
  await prisma.$disconnect();
  db.cleanup();
});

describe("ADMIN_PASSWORD_HASH from the environment", () => {
  it("is mirrored into AppSetting so removing the variable keeps the password", async () => {
    const { prisma } = await import("../src/db/client");
    const row = await prisma.appSetting.findUniqueOrThrow({ where: { id: 1 } });
    assert.equal(row.adminPasswordHash, process.env.ADMIN_PASSWORD_HASH);
  });

  it("is not in setup mode and the password logs in", async () => {
    assert.equal((await t.safe("GET", "/api/session")).json.setupRequired, false);
    assert.equal((await t.safe("POST", "/api/session/login", { body: { password: PASSWORD } })).status, 200);
  });

  it("setup is refused", async () => {
    const res = await t.safe("POST", "/api/session/setup", { body: { password: "some other password", setupCode: "x" } });
    assert.equal(res.status, 409);
  });

  it("change-password is refused while the variable is set", async () => {
    const { Jar } = await import("./helpers");
    const jar = new Jar();
    await t.safe("POST", "/api/session/login", { jar, body: { password: PASSWORD } });
    const res = await t.safe("POST", "/api/session/password", {
      jar,
      body: { currentPassword: PASSWORD, newPassword: "a brand new password" },
    });
    assert.equal(res.status, 409);
    assert.equal((await t.safe("GET", "/api/session", { jar })).json.passwordManagedByEnv, true);
  });
});
