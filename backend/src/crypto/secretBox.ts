import crypto from "node:crypto";
import { config } from "../config/env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const key = Buffer.from(config.ENCRYPTION_KEY, "base64");

/** Encrypts a UTF-8 string, returning "iv:authTag:ciphertext" (all base64). */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/** Reverses encrypt(). Throws if the payload is malformed or the auth tag doesn't match. */
export function decrypt(payload: string): string {
  const [ivB64, authTagB64, ciphertextB64] = payload.split(":");
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("Malformed encrypted payload");
  }
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

export function encryptOrNull(plaintext: string | null | undefined): string | null {
  return plaintext == null ? null : encrypt(plaintext);
}

export function decryptOrNull(payload: string | null | undefined): string | null {
  return payload == null ? null : decrypt(payload);
}
