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
