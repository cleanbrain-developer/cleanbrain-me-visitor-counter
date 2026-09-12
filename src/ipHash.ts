import { createHmac } from "node:crypto";
import { env } from "./env.js";

// Raw IP addresses are never stored — only this HMAC digest, so the DB file
// on disk never contains PII even if it leaked.
export function hashIp(ip: string): string {
  return createHmac("sha256", env.ipHashSalt).update(ip).digest("hex");
}
