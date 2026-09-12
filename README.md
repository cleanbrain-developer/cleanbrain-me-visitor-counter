# cleanbrain-me-visitor-counter

Shared anonymous "today visitor count" API for every `cleanbrain.me` service
(`entrance`, `developer`, `english-core-speaking`, `relayhub-java`,
`kioti-crm-discount`). A visitor is the distinct `(IP, User-Agent)` pair seen
that day, per service.

Deployment manifests for this service live in `cleanbrain-me-infra`, not
here, following the same split used by every other application in that
cluster.

## API

### `POST /v1/visits`

Body: `{ "service": "<service-id>" }`

Records one visit for the caller's IP (hashed, never stored raw) and
User-Agent. Responds `204` on success, `400` if `service` is missing or
unrecognized.

### `GET /v1/visits/today?service=<service-id>&tz=<IANA timezone>`

Returns `{ "service", "tz", "count" }`, where `count` is the number of
distinct `(IP, User-Agent)` visitors recorded between local midnight and the
next local midnight in `tz`, computed from UTC-stored timestamps. `400` if
`service` is unrecognized or `tz` is not a valid IANA timezone name.

### `GET /healthz`

Liveness/readiness check.

## Data model

Single SQLite table (`visits`): `service`, `ip_hash` (HMAC-SHA256 of the
client IP, salted with `VISITOR_IP_HASH_SALT` — the raw IP is never
persisted), `user_agent`, `created_at` (UTC ISO 8601). Rows older than
`VISITOR_RETENTION_DAYS` (default 3) are purged daily; only "today" is ever
queried, so no long-term history is kept.

## Environment variables

See `.env.example`. `VISITOR_IP_HASH_SALT` and `ALLOWED_ORIGINS` are
required in production; see `cleanbrain-me-infra`'s
`kubernetes/apps/visitor-counter/secret.example.yaml`.

## Local development

```bash
npm install
cp .env.example .env
npm run dev
```

## Deployment

CI (`.github/workflows/deploy.yml`) builds and pushes
`ghcr.io/cleanbrain-developer/cleanbrain-me-visitor-counter` on every push to
`main`, then rolls out the running Deployment over SSH — same model as
`cleanbrain-me-entrance`. First-time cluster bootstrap (namespace, RBAC,
Secret, PVC, Deployment, Service, HTTPRoute, DNS record, Gateway listener) is
documented in `cleanbrain-me-infra`'s `README.md` and is performed manually
by the cluster administrator, not by CI.
