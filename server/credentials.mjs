import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt);
const OPTIONS = { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 };

// Call only in a trusted provisioning process. Never put passwords, verifiers,
// session tokens or this module into the public static-site build.
export async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 8 || Buffer.byteLength(password, "utf8") > 256) throw new Error("密碼長度不合要求。");
  const salt = randomBytes(16);
  const key = await derive(password, salt, 64, OPTIONS);
  return `scrypt$131072$8$1$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password, record) {
  if (typeof password !== "string" || Buffer.byteLength(password, "utf8") > 256 || typeof record !== "string") return false;
  const parts = record.split("$");
  if (parts.length !== 6 || parts.slice(0, 4).join("$") !== "scrypt$131072$8$1" || !/^[a-f0-9]{32}$/.test(parts[4]) || !/^[a-f0-9]{128}$/.test(parts[5])) return false;
  const actual = await derive(password, Buffer.from(parts[4], "hex"), 64, OPTIONS);
  return timingSafeEqual(actual, Buffer.from(parts[5], "hex"));
}

export function newSessionToken() { return randomBytes(32).toString("base64url"); }
export function tokenDigest(token) { return createHash("sha256").update(token).digest("hex"); }
