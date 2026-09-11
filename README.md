# Java estate — quality & lifecycle dashboard

A portfolio view over Java repositories, combining **SonarQube** (quality),
**Checkmarx** (SAST), **Sonatype Lifecycle** (SCA/licence) and plain-text repo
analysis (framework/LCM posture).

**All QA data is mocked** — see `scripts/generate-mock.ts`. It is deterministic, so
the demo shows identical data on every run. The Spring Boot and Java support states
are illustrative values chosen to exercise the UI, not authoritative EOL dates.

## Run it

Requires Docker (Postgres runs in a container).

```bash
npm install
make ingest     # start Postgres, apply schema, load data/seed.json
make dev        # http://localhost:5173  (app and API share one port)
```

## Commands

| Command | Does |
|---|---|
| `make dev` | Start Postgres, then app + API on :5173 |
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

### Endpoints

| Route | Returns |
|---|---|
| `GET /api/portfolio` | Totals, 12-week trend, all repository summaries |
| `GET /api/repos/:name` | One repository with its scan history |
| `GET /api/components?q=` | Repositories shipping a matching component |
| `POST /api/reset` | Re-apply schema and re-ingest the seed |

## Layout

- `shared/types.ts` — the API contract, imported by frontend **and** server
- `server/` — route table (framework-free), flat-file store, risk scoring
- `src/` — no-framework TypeScript UI; `fetch` lives only in `src/api.ts`
- `specs/` + `tests/` — test plan and Playwright e2e
