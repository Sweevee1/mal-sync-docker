import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { blankEnv, makeScryptHash, setupTestDb } from "./helpers";

// RESET_ADMIN_PASSWORD=true on boot: the stored hash and every session go away
// and the app is back in setup mode with a fresh setup code.
blankEnv("ENCRYPTION_KEY", "ADMIN_PASSWORD_HASH", "PUBLIC_BASE_URL");
process.env.RESET_ADMIN_PASSWORD = "true";
const db = setupTestDb();

after(async () => {
  const { prisma } = await import("../src/db/client");
  await prisma.$disconnect();
  db.cleanup();
});

describe("RESET_ADMIN_PASSWORD", () => {
  let hadSession = false;

  before(async () => {
    const { prisma } = await import("../src/db/client");
    await prisma.appSetting.upsert({
      where: { id: 1 },
      create: { id: 1, adminPasswordHash: makeScryptHash("old password value") },
      update: { adminPasswordHash: makeScryptHash("old password value") },
    });
    await prisma.session.create({ data: { idHash: "stale", expiresAt: new Date(Date.now() + 60_000) } });
    hadSession = (await prisma.session.count()) === 1;
    const { initAuth } = await import("../src/auth/session");
    await initAuth();
  });

  it("clears the stored hash, all sessions, and returns to setup mode", async () => {
    const { prisma } = await import("../src/db/client");
    const { getAdminHash, setupCodeMatches } = await import("../src/auth/adminCredential");
    assert.ok(hadSession);
    assert.equal(await getAdminHash(), null);
    assert.equal(await prisma.session.count(), 0);
    assert.equal(setupCodeMatches("definitely wrong"), false);
  });
});
