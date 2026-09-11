.PHONY: dev db-up db-down db-nuke ingest psql test test-ci check reset mock clean

# Start Postgres and wait until it accepts connections.
db-up:
	docker compose up -d
	@until [ "$$(docker inspect -f '{{.State.Health.Status}}' estate-db 2>/dev/null)" = healthy ]; do sleep 1; done
	@echo "postgres healthy on localhost:5433"

db-down:
	docker compose down

# Also removes the volume — next ingest starts from nothing.
db-nuke:
	docker compose down -v

# Apply the schema and load data/seed.json into Postgres.
ingest: db-up
	node server/db/ingest.ts

psql:
	docker exec -it estate-db psql -U estate -d estate

# Start the app + API on one port. Serve over HTTP — never open index.html as file://.
dev: db-up
	@mkdir -p .artifacts
	npm run dev

# Headed by default so the room can watch the tests drive the real UI.
test: db-up
	PLAYWRIGHT_HTML_OPEN=never npx playwright test --headed --workers=1

test-ci: db-up
	PLAYWRIGHT_HTML_OPEN=never npx playwright test

check: db-up
	npm run typecheck
	PLAYWRIGHT_HTML_OPEN=never npx playwright test

# Restore the demo to the committed known-good state (re-applies schema + re-ingests).
reset:
	@curl -s -o /dev/null -X POST localhost:5173/api/reset 2>/dev/null \
		&& echo "portfolio re-ingested from data/seed.json" \
		|| node server/db/ingest.ts

# Re-roll the mocked QA data (deterministic — same output every run), then load it.
mock:
	node scripts/generate-mock.ts
	$(MAKE) ingest

clean:
	rm -rf .artifacts .playwright-cli
