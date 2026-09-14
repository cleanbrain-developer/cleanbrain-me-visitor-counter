# cleanbrain-me-visitor-counter

Shared anonymous "today" and "all-time" visitor count API for every
`cleanbrain.me` service (`entrance`, `developer`, `english-core-speaking`,
`relayhub-java`, `kioti-crm-discount`). A visitor is the distinct
`(IP, User-Agent)` pair seen for a service on a given day — "today" scopes
that to the caller's local calendar day; "all-time" is a running total of
unique-visitor-days (a returning visitor is counted again on each new *local*
day they show up, the same way "today" counts them again tomorrow), so it
only ever goes up and never stalls once everyone who'll ever visit has
visited once.

Deployment manifests for this service live in `cleanbrain-me-infra`, not
here, following the same split used by every other application in that
cluster.

## API

### `POST /v1/visits`

Body: `{ "service": "<service-id>", "tz": "<IANA timezone>" }`

Records one visit for the caller's IP (hashed, never stored raw) and
User-Agent, bucketed under the caller's own local calendar date in `tz`
(not the server's UTC date) for "all-time" purposes -- see "All" below for
why this matters. Responds `204` on success, `400` if `service` is missing
or unrecognized, or `tz` is missing or not a valid IANA timezone name.

### `GET /v1/visits/today?service=<service-id>&tz=<IANA timezone>`

Returns `{ "service", "tz", "count" }`, where `count` is the number of
distinct `(IP, User-Agent)` visitors recorded between local midnight and the
next local midnight in `tz`, computed from UTC-stored timestamps. `400` if
`service` is unrecognized or `tz` is not a valid IANA timezone name.

### `GET /v1/visits/all?service=<service-id>`

Returns `{ "service", "count" }`, where `count` is the number of distinct
`(service, IP, User-Agent, local calendar day)` combinations ever recorded
-- i.e. a cumulative total of unique-visitor-days, not unique-visitors-ever,
so a visitor who returns on a later day adds to it again. The day boundary
is the *caller's own local day* (from the `tz` sent on `POST /v1/visits`),
matching "Today"'s boundary exactly -- using the server's UTC day instead
would let a visit made just after local midnight (in any timezone ahead of
UTC) still count toward the previous day for up to the timezone's UTC
offset, silently missing a same-day return visit until UTC midnight also
passed. `400` if `service` is unrecognized.

### `GET /healthz`

Liveness/readiness check.

## Data model

Two SQLite tables. `visits` — `service`, `ip_hash` (HMAC-SHA256 of the
client IP, salted with `VISITOR_IP_HASH_SALT` — the raw IP is never
persisted), `user_agent`, `created_at` (UTC ISO 8601), `day` (the caller's
local calendar date from the request's `tz`) — is a short-lived raw log:
rows older than `VISITOR_RETENTION_DAYS` (default 3) are purged daily,
since only "today" is ever queried against it. `visitor_seen` — one
permanent row per distinct `(service, ip_hash, user_agent, day)` ever seen,
never purged — is what "all-time" is computed from; `visits` alone can't
answer that question once old rows are gone. Both tables' `day` columns
store the caller's own local date, not the server's UTC date -- deriving it
from UTC alone would misattribute a visit made just after local midnight
(in any timezone ahead of UTC) to the previous local day.

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
