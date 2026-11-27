import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Request } from "express";
import { blankEnv } from "./helpers";

// Config loads at import and writes encryption.key beside the database, so point it at a temp dir.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "msd-base-"));
process.env.DATABASE_URL = `file:${path.join(dir, "unused.db").split(path.sep).join("/")}`;
blankEnv("ENCRYPTION_KEY", "ADMIN_PASSWORD_HASH", "PUBLIC_BASE_URL", "RESET_ADMIN_PASSWORD");

let resolveBaseUrl: typeof import("../src/auth/peer").resolveBaseUrl;
before(async () => {
  ({ resolveBaseUrl } = await import("../src/auth/peer"));
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

function fakeReq(host: string | undefined, peer: string, trustedHop = false): Request {
  return {
    get: (name: string) => (name.toLowerCase() === "host" ? host : undefined),
    socket: { remoteAddress: peer },
    app: { get: () => (trustedHop ? () => true : undefined) },
  } as unknown as Request;
}

describe("resolveBaseUrl", () => {
  it("returns a configured PUBLIC_BASE_URL verbatim, whatever the request says", () => {
    const req = fakeReq("evil.example.test", "8.8.8.8");
    assert.equal(resolveBaseUrl({ PUBLIC_BASE_URL: "https://sync.example.com" }, req), "https://sync.example.com");
  });

  it("derives http://<Host> for a private peer", () => {
    assert.equal(resolveBaseUrl({ PUBLIC_BASE_URL: undefined }, fakeReq("192.168.1.10:3000", "192.168.1.20")), "http://192.168.1.10:3000");
    assert.equal(resolveBaseUrl({ PUBLIC_BASE_URL: undefined }, fakeReq("unraid.local:3000", "::ffff:10.0.0.5")), "http://unraid.local:3000");
  });

  it("refuses a public peer", () => {
    assert.throws(() => resolveBaseUrl({ PUBLIC_BASE_URL: undefined }, fakeReq("192.168.1.10:3000", "8.8.8.8")), /PUBLIC_BASE_URL/);
  });

  it("refuses a peer that is a trusted proxy hop", () => {
    assert.throws(() => resolveBaseUrl({ PUBLIC_BASE_URL: undefined }, fakeReq("192.168.1.10:3000", "127.0.0.1", true)), /PUBLIC_BASE_URL/);
  });

  for (const host of [undefined, "", "evil.com/path", "a b", "host@evil.com", "x.com:99999999", "[::1]:3000", "evil.com#x", "a..b"]) {
    it(`refuses the Host ${JSON.stringify(host)}`, () => {
      assert.throws(() => resolveBaseUrl({ PUBLIC_BASE_URL: undefined }, fakeReq(host, "192.168.1.20")), /PUBLIC_BASE_URL/);
    });
  }
});
