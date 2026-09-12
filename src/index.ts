import cors from "cors";
import express from "express";
import { purgeOldVisits } from "./db.js";
import { env } from "./env.js";
import { router } from "./routes.js";

const app = express();

// Traefik is the only reverse proxy hop between the client and this Pod, so
// trusting exactly one hop gives req.ip the real client address instead of
// Traefik's own.
app.set("trust proxy", 1);

app.use(express.json());
app.use(
  cors({
    origin: env.allowedOrigins.length > 0 ? env.allowedOrigins : false,
    methods: ["GET", "POST"],
  }),
);

app.use(router);

app.listen(env.port, () => {
  console.log(`visitor-counter listening on :${env.port}`);
});

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
setInterval(() => {
  const deleted = purgeOldVisits();
  if (deleted > 0) {
    console.log(`purged ${deleted} visit rows older than ${env.retentionDays}d`);
  }
}, ONE_DAY_MS).unref();
