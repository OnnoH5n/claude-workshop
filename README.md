# Java estate — quality & lifecycle dashboard

A portfolio view over Java repositories, combining **SonarQube** (quality),
**Checkmarx** (SAST), **Sonatype Lifecycle** (SCA/licence) and plain-text repo
analysis (framework/LCM posture).

**All QA data is mocked** — see `scripts/generate-mock.ts`. It is deterministic, so
the demo shows identical data on every run.

The **Spring Boot support ladder is real**, verified 2026-09-11 against spring.io's
`/projects/spring-boot/generations` API and endoflife.date (the two agreed exactly on
every date). Current GA is **4.1**; only 4.1 and 4.0 remain in OSS support. Note the
3.x series ended at 3.5 — there is no 3.6. Re-verify before quoting these dates: they
move every few months, and they are end-of-month policy boundaries, not precise cutoffs.

3.5 and 2.7 are "extended support" generations, so both read as `oss-ended` rather
than `eol` despite 2.7 being eight minor lines behind. Support state alone therefore
understates lifecycle risk, which is why `backend/risk.py` also weights distance from
current and a sub-Java-17 baseline.

## Architecture

Three tiers. The browser never touches the database.

```
browser  (src/, TypeScript, no framework)
   |  fetch('/api/...')  — same origin, no CORS
   v
Vite :5173  — serves the frontend, proxies /api
   |
   v
FastAPI :8000  (backend/, Python)  — the only thing that speaks to Postgres
   |  psycopg
   v
Postgres :5433  (docker compose)
```

In production the FastAPI process serves the built frontend from `dist/` itself,
so Vite is a development-only hop.

## Run it

Requires Docker (Postgres) and Python 3.12+.

```bash
npm install
make venv       # create backend/.venv and install Python deps
make ingest     # start Postgres, apply schema, load data/seed.json
make dev        # http://localhost:5173 — runs the API and frontend together
```

## Commands

| Command | Does |
|---|---|
| `make dev` | Start Postgres, then the Python API (:8000) and Vite (:5173) |
| `make api` | Just the FastAPI service, with reload |
| `make web` | Just Vite |
| `make venv` | Create `backend/.venv` and install Python deps |
| `make ingest` | Apply schema and load `data/seed.json` |
| `make test` | E2E suite, headed |
| `make check` | Typecheck both projects, then the full suite |
| `make psql` | Open a psql shell against the container |
| `make reset` | Re-apply schema and re-ingest the seed |
| `make mock` | Regenerate the mocked QA data, then load it |
| `make db-nuke` | Stop Postgres and delete its volume |

## Database

Postgres 17 (`docker-compose.yml`, host port **5433** to avoid colliding with a
local install). Override with `DATABASE_URL`.

Scans are **append-only snapshots with absolute timestamps**; every dashboard read
starts from the `repo_current` view, which is `DISTINCT ON (repository_id, tool)
ORDER BY captured_at DESC`. Each scan keeps the vendor's raw response in a `payload`
jsonb column *and* promotes the queried fields into typed columns, so a vendor adding
a field costs no migration.

Three things the relational model makes real that the flat file only approximated:

- **`finding` holds one row per finding** with `first_seen_at`, so SLA ageing and
  MTTR are computed, not estimated from a per-severity `oldestDays`.
- **`component_usage` is a real inventory**, so `GET /api/components?q=log4j`
  answers "which repos ship this, at what version" during an incident.
- **`risk_snapshot` stores the score as reported**, with a `formula_version`.
  Recomputing on read would silently rewrite past quarters whenever the formula is
  recalibrated — and it has been, twice.

`schema.sql` is **idempotent and drops nothing**; clearing data is a separate
`TRUNCATE` in `ingest.py`. Earlier it dropped and recreated the enum types, which
changed their OIDs and broke pooled psycopg connections still holding the old ones
(`cache lookup failed for type NNNNN`) — a reset is not a schema migration.

### Endpoints

| Route | Returns |
|---|---|
| `GET /api/portfolio` | Totals, 12-week trend, all repository summaries |
| `GET /api/repos/:name` | One repository with its scan history |
| `GET /api/components?q=` | Repositories shipping a matching component |
| `POST /api/reset` | Re-apply schema and re-ingest the seed |

## Layout

- `src/` — no-framework TypeScript UI; `fetch` lives only in `src/api.ts`
- `shared/types.ts` — the contract as the **frontend** sees it
- `backend/` — FastAPI service: `main.py` (routes), `queries.py` (SQL),
  `ingest.py` (seed loading), `risk.py` (scoring), `models.py` (Pydantic),
  `schema.sql` (idempotent DDL)
- `scripts/generate-mock.ts` — stands in for the vendor APIs; emits **raw metrics
  only**, so scoring lives in exactly one place (`backend/risk.py`)
- `specs/` + `tests/` — test plan and Playwright e2e

### The contract is defined twice

`shared/types.ts` (TypeScript, for the browser) and `backend/models.py` (Pydantic,
for the API) describe the same JSON. That duplication is the real cost of a Python
backend behind a TypeScript frontend, and it is the one thing here that can drift
silently — **edit them together**.

The intended fix is generation, not discipline: FastAPI publishes an OpenAPI schema
at `http://localhost:8000/openapi.json`, so `shared/types.ts` can be generated from
`backend/models.py`. That step is not wired up yet.
