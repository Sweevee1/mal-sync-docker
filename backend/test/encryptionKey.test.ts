import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataDirFromDatabaseUrl, isValidKey, resolveEncryptionKey } from "../src/config/encryptionKey";

const newKey = () => crypto.randomBytes(32).toString("base64");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "msd-key-"));
const posix = process.platform !== "win32";

describe("resolveEncryptionKey", () => {
  it("generates a key file when nothing is set, and reuses it on the next boot", () => {
    const dir = tmp();
    const first = resolveEncryptionKey(undefined, dir);
    assert.ok(isValidKey(first.key));
    assert.equal(first.warnings.length, 1);
    if (posix) assert.equal(fs.statSync(path.join(dir, "encryption.key")).mode & 0o777, 0o600);
    const second = resolveEncryptionKey(undefined, dir);
    assert.equal(second.key, first.key);
    assert.deepEqual(second.warnings, []);
  });

  it("uses the variable and copies it to the file so removing the variable keeps the key", () => {
    const dir = tmp();
    const key = newKey();
    assert.equal(resolveEncryptionKey(key, dir).key, key);
    if (posix) assert.equal(fs.statSync(path.join(dir, "encryption.key")).mode & 0o777, 0o600);
    assert.equal(resolveEncryptionKey(undefined, dir).key, key);
  });

  it("lets the variable win over a different file and warns", () => {
    const dir = tmp();
    const fileKey = newKey();
    const envKey = newKey();
    fs.writeFileSync(path.join(dir, "encryption.key"), fileKey);
    const resolved = resolveEncryptionKey(envKey, dir);
    assert.equal(resolved.key, envKey);
    assert.match(resolved.warnings.join(" "), /differs/);
    assert.equal(fs.readFileSync(path.join(dir, "encryption.key"), "utf8"), fileKey);
  });

  it("refuses a corrupt key file instead of replacing it", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "encryption.key"), "not a key");
    assert.throws(() => resolveEncryptionKey(undefined, dir), /32-byte/);
    assert.equal(fs.readFileSync(path.join(dir, "encryption.key"), "utf8"), "not a key");
  });
});

describe("dataDirFromDatabaseUrl", () => {
  it("uses the directory of an absolute file URL", () => {
    assert.equal(dataDirFromDatabaseUrl("file:/app/data/malsync.db"), path.dirname("/app/data/malsync.db"));
  });
  it("ignores query parameters", () => {
    assert.equal(dataDirFromDatabaseUrl("file:/app/data/malsync.db?connection_limit=1"), path.dirname("/app/data/malsync.db"));
  });
});
