import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "./env.js";

mkdirSync(dirname(env.dbPath), { recursive: true });

export const db = new Database(env.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service TEXT NOT NULL,
    ip_hash TEXT NOT NULL,
    user_agent TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_visits_service_created_at
    ON visits(service, created_at);

  -- Permanent (never purged) record of every distinct (service, ip_hash,
  -- user_agent) ever seen, one row each. This is what "All" (cumulative
  -- unique visitors) is computed from -- "visits" above only keeps a few
  -- days of raw log and can't answer an all-time question.
  CREATE TABLE IF NOT EXISTS visitor_seen (
    service TEXT NOT NULL,
    ip_hash TEXT NOT NULL,
    user_agent TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    PRIMARY KEY (service, ip_hash, user_agent)
  );
`);

// One-time-per-restart backfill: visitor_seen didn't exist before this
// table was added, so any visitor already sitting in the still-unpurged
// "visits" raw log (up to VISITOR_RETENTION_DAYS old) would otherwise be
// invisible to "all-time" until they happened to visit again -- making
// All briefly read lower than Today, which can never be true by
// definition (today's visitors are a subset of all-time visitors).
// INSERT OR IGNORE makes this idempotent, so it's safe to run on every
// startup rather than needing a separate one-shot migration step.
db.exec(`
  INSERT OR IGNORE INTO visitor_seen (service, ip_hash, user_agent, first_seen_at)
  SELECT service, ip_hash, user_agent, MIN(created_at)
  FROM visits
  GROUP BY service, ip_hash, user_agent;
`);

export function purgeOldVisits(): number {
  const cutoff = new Date(
    Date.now() - env.retentionDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const result = db
    .prepare("DELETE FROM visits WHERE created_at < ?")
    .run(cutoff);
  return result.changes;
}
