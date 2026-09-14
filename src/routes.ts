import { Router } from "express";
import { db } from "./db.js";
import { hashIp } from "./ipHash.js";
import { InvalidTimezoneError, getTodayUtcRange } from "./timezone.js";

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
  const { service } = req.body ?? {};
  if (!isKnownService(service)) {
    res.status(400).json({ error: "invalid or missing 'service'" });
    return;
  }

  const ipHash = hashIp(req.ip ?? "unknown");
  const userAgent = req.get("user-agent") ?? "unknown";
  const createdAt = new Date().toISOString();
  const day = createdAt.slice(0, 10); // UTC calendar day, e.g. "2026-09-14"

  db.prepare(
    "INSERT INTO visits (service, ip_hash, user_agent, created_at) VALUES (?, ?, ?, ?)",
  ).run(service, ipHash, userAgent, createdAt);

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

// Temporary diagnostic route -- every visitor is currently hashing to the
// same ip_hash regardless of real device/network, which means req.ip is
// resolving to a constant (almost certainly the proxy hop's own address,
// not the real client). This reflects back exactly what Express sees so
// the actual header chain can be inspected from outside the cluster
// instead of guessing. Remove once the root cause is confirmed and fixed.
router.get("/debug/ip", (req, res) => {
  res.json({
    reqIp: req.ip,
    reqIps: req.ips,
    xForwardedFor: req.headers["x-forwarded-for"] ?? null,
    xRealIp: req.headers["x-real-ip"] ?? null,
    socketRemoteAddress: req.socket.remoteAddress ?? null,
  });
});
