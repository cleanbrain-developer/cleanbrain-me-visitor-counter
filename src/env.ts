function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  dbPath: process.env.DATABASE_PATH ?? "/app/data/visitor-counter.db",
  ipHashSalt: required("VISITOR_IP_HASH_SALT"),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  // Rows older than this are purged so the SQLite file stays small — only
  // "today" (in any timezone) is ever queried, so a few days of buffer is
  // plenty and nothing needs long-term history.
  retentionDays: Number(process.env.VISITOR_RETENTION_DAYS ?? 3),
};
