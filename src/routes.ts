import { Router } from "express";
import { db } from "./db.js";
import { hashIp } from "./ipHash.js";
import {
  InvalidTimezoneError,
  getLocalDateString,
  getTodayUtcRange,
} from "./timezone.js";

export const router = Router();

const KNOWN_SERVICES = new Set([
  "entrance",
  "developer",
  "english-core-speaking",
  "relayhub-java",
  "kioti-crm-discount",
]);

function isKnownService(value: unknown): value is string {
  return typeof value === "string" && KNOWN_SERVICES.has(value);
}

router.post("/v1/visits", (req, res) => {
  const { service, tz } = req.body ?? {};
  if (!isKnownService(service)) {
    res.status(400).json({ error: "invalid or missing 'service'" });
    return;
  }
  if (typeof tz !== "string" || tz.length === 0) {
    res.status(400).json({ error: "missing 'tz'" });
    return;
  }

  const ipHash = hashIp(req.ip ?? "unknown");
  const userAgent = req.get("user-agent") ?? "unknown";
  const createdAt = new Date().toISOString();

  // The caller's own local calendar day, not the server's UTC day -- see
  // getLocalDateString's comment. Using UTC here would let a visit made
  // just after local midnight (in any timezone ahead of UTC) still land on
  // the previous UTC day, silently missing a same-day return visit from
  // "All" until UTC midnight also passes.
  let day: string;
  try {
    day = getLocalDateString(tz);
  } catch (err) {
    if (err instanceof InvalidTimezoneError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  db.prepare(
    "INSERT INTO visits (service, ip_hash, user_agent, created_at, day) VALUES (?, ?, ?, ?, ?)",
  ).run(service, ipHash, userAgent, createdAt, day);

  db.prepare(
    `INSERT OR IGNORE INTO visitor_seen (service, ip_hash, user_agent, day, first_seen_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(service, ipHash, userAgent, day, createdAt);

  res.status(204).end();
});

router.get("/v1/visits/today", (req, res) => {
  const service = req.query.service;
  const tz = req.query.tz;

  if (!isKnownService(service)) {
    res.status(400).json({ error: "invalid or missing 'service'" });
    return;
  }
  if (typeof tz !== "string" || tz.length === 0) {
    res.status(400).json({ error: "missing 'tz'" });
    return;
  }

  let range: { start: Date; end: Date };
  try {
    range = getTodayUtcRange(tz);
  } catch (err) {
    if (err instanceof InvalidTimezoneError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM (
         SELECT DISTINCT ip_hash, user_agent
         FROM visits
         WHERE service = ? AND created_at >= ? AND created_at < ?
       )`,
    )
    .get(service, range.start.toISOString(), range.end.toISOString()) as {
    count: number;
  };

  res.json({ service, tz, count: row.count });
});

router.get("/v1/visits/all", (req, res) => {
  const service = req.query.service;

  if (!isKnownService(service)) {
    res.status(400).json({ error: "invalid or missing 'service'" });
    return;
  }

  const row = db
    .prepare("SELECT COUNT(*) AS count FROM visitor_seen WHERE service = ?")
    .get(service) as { count: number };

  res.json({ service, count: row.count });
});

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});
