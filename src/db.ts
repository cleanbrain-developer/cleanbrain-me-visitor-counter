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
  -- user_agent, day) combination ever seen, one row each -- "day" is the
  -- UTC calendar date, so a returning visitor is counted again on each new
  -- day they show up, the same way "Today" counts them again tomorrow.
  -- "All" is a running total of unique-visitor-days, not unique-visitors-
  -- ever: it only ever goes up, including from return visits, which reads
  -- as a proper cumulative counter rather than a number that stalls once
  -- everyone who'll ever visit has visited once.
  CREATE TABLE IF NOT EXISTS visitor_seen (
    service TEXT NOT NULL,
    ip_hash TEXT NOT NULL,
    user_agent TEXT NOT NULL,
    day TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    PRIMARY KEY (service, ip_hash, user_agent, day)
  );
`);

// Migrate the earlier schema (no "day" column, one row per visitor ever,
// not per visitor-day). Detected by column absence rather than a version
// table since this is the only schema change so far; each visitor's
// existing first_seen_at's own date becomes their first counted day so no
// history is discarded, just re-bucketed.
const visitorSeenColumns = db
  .prepare("PRAGMA table_info(visitor_seen)")
  .all() as Array<{ name: string }>;
if (!visitorSeenColumns.some((c) => c.name === "day")) {
  db.exec(`
    ALTER TABLE visitor_seen RENAME TO visitor_seen_pre_day;
    CREATE TABLE visitor_seen (
      service TEXT NOT NULL,
      ip_hash TEXT NOT NULL,
      user_agent TEXT NOT NULL,
      day TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      PRIMARY KEY (service, ip_hash, user_agent, day)
    );
    INSERT OR IGNORE INTO visitor_seen (service, ip_hash, user_agent, day, first_seen_at)
    SELECT service, ip_hash, user_agent, substr(first_seen_at, 1, 10), first_seen_at
    FROM visitor_seen_pre_day;
    DROP TABLE visitor_seen_pre_day;
  `);
}

// One-time-per-restart backfill: visitor_seen didn't exist before this
// table was added, so any visitor already sitting in the still-unpurged
// "visits" raw log (up to VISITOR_RETENTION_DAYS old) would otherwise be
// invisible to "all-time" until they happened to visit again -- making
// All briefly read lower than Today, which can never be true by
// definition (today's visitors are a subset of all-time visitors).
// INSERT OR IGNORE makes this idempotent, so it's safe to run on every
// startup rather than needing a separate one-shot migration step.
db.exec(`
  INSERT OR IGNORE INTO visitor_seen (service, ip_hash, user_agent, day, first_seen_at)
  SELECT service, ip_hash, user_agent, substr(created_at, 1, 10), MIN(created_at)
  FROM visits
  GROUP BY service, ip_hash, user_agent, substr(created_at, 1, 10);
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
