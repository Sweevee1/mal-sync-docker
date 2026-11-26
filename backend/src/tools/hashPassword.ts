import crypto from "node:crypto";

// N=16384, r=8, p=1 with a 64-byte key matches what auth/password.ts verifies.
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const password = (await readStdin()).replace(/\r?\n$/, "");
  if (!password) {
    console.error("No password received on stdin.");
    process.exit(1);
  }
  const N = 16384;
  const r = 8;
  const p = 1;
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N, r, p });
  console.log(`scrypt:${N}:${r}:${p}:${salt.toString("base64url")}:${hash.toString("base64url")}`);
}

main();
