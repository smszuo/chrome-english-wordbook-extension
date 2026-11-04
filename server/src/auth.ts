import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

// Stored as "<salt hex>:<key hex>".
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;
  const key = Buffer.from(keyHex, "hex");
  const got = await scryptAsync(password, Buffer.from(saltHex, "hex"), key.length);
  return timingSafeEqual(key, got);
}

export const newToken = () => randomBytes(32).toString("base64url");

// Only the hash is stored, so a DB leak does not leak usable tokens.
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
