# Java estate — quality & lifecycle dashboard

A portfolio view over Java repositories, combining **SonarQube** (quality),
**Checkmarx** (SAST), **Sonatype Lifecycle** (SCA/licence) and plain-text repo
analysis (framework/LCM posture).

**All QA data is mocked** — see `scripts/generate-mock.ts`. It is deterministic, so
the demo shows identical data on every run. The Spring Boot and Java support states
are illustrative values chosen to exercise the UI, not authoritative EOL dates.

## Run it

```bash
npm install
make dev        # http://localhost:5173  (app and API share one port)
```

## Commands

| Command | Does |
|---|---|
| `make dev` | Start app + API on :5173 |
| `make test` | E2E suite, headed |
| `make check` | Typecheck both projects, then the full suite |
| `make reset` | Restore the portfolio to `data/seed.json` |
| `make mock` | Regenerate the mocked QA data |

## Layout

- `shared/types.ts` — the API contract, imported by frontend **and** server
- `server/` — route table (framework-free), flat-file store, risk scoring
- `src/` — no-framework TypeScript UI; `fetch` lives only in `src/api.ts`
- `specs/` + `tests/` — test plan and Playwright e2e
