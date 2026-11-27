import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";

export function makeScryptHash(password: string): string {
  const N = 16384;
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N, r: 8, p: 1 });
  return `scrypt:${N}:8:1:${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

// dotenv never overrides a defined variable, so "" (not delete) is what keeps
// a developer's backend/.env from leaking into a test that wants it unset.
export function blankEnv(...names: string[]): void {
  for (const name of names) process.env[name] = "";
}

/** Temp data dir plus a migrated SQLite file; sets DATABASE_URL. Call before importing src. */
export function setupTestDb(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "msd-test-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
  const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: path.resolve(__dirname, ".."),
    env: process.env,
    shell: true,
    encoding: "utf8",
  });
  if (migrate.status !== 0) throw new Error(`prisma migrate deploy failed:\n${migrate.stdout}\n${migrate.stderr}`);
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

export type Res = { status: number; headers: http.IncomingHttpHeaders; json: any };

export class Jar {
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
    return this.cookies.size === 0 ? undefined : [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

export type Client = {
  port: number;
  origin: string;
  /** Carries Origin + X-MSD-Request, as the real frontend would. */
  safe: (method: string, urlPath: string, opts?: { body?: unknown; jar?: Jar; headers?: Record<string, string> }) => Promise<Res>;
  close: () => Promise<void>;
};

export async function startServer(app: http.RequestListener): Promise<Client> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  const safe: Client["safe"] = (method, urlPath, opts = {}) =>
    new Promise((resolve) => {
      const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
      const headers: Record<string, string> = {
        Connection: "close",
        Origin: origin,
        "X-MSD-Request": "1",
        ...(opts.headers ?? {}),
      };
      if (payload !== undefined) {
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = String(Buffer.byteLength(payload));
      }
      const cookie = opts.jar?.header();
      if (cookie) headers["Cookie"] = cookie;
      const req = http.request({ host: "127.0.0.1", port, method, path: urlPath, headers, agent: false }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          opts.jar?.absorb(res.headers["set-cookie"]);
          let json: any;
          try {
            json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            // not JSON
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, json });
        });
      });
      req.setTimeout(5000, () => {
        req.destroy();
        resolve({ status: 0, headers: {}, json: undefined });
      });
      req.on("error", () => resolve({ status: 0, headers: {}, json: undefined }));
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  return {
    port,
    origin,
    safe,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
