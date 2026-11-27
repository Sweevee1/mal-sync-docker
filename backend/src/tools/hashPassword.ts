import { hashPassword } from "../auth/password";

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
  console.log(await hashPassword(password));
}

main();
