.PHONY: dev api web db-up db-down db-nuke ingest psql venv test test-ci check reset mock clean

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

venv:
	python3 -m venv backend/.venv
	backend/.venv/bin/python -m pip install -q -r backend/requirements.txt

# Apply the schema and load data/seed.json (scoring risk on the way in).
ingest: db-up
	backend/.venv/bin/python backend/ingest.py

psql:
	docker exec -it estate-db psql -U estate -d estate

# Both tiers. The Python API owns Postgres; Vite serves the frontend and proxies
# /api to it, so the browser sees one origin. Ctrl-C stops both.
dev: db-up
	@mkdir -p .artifacts
	@$(MAKE) -j2 api web

api: db-up
	backend/.venv/bin/uvicorn main:app --app-dir backend --port 8000 --reload

web:
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
	@curl -s -o /dev/null -X POST localhost:8000/api/reset 2>/dev/null \
		&& echo "portfolio re-ingested from data/seed.json" \
		|| backend/.venv/bin/python backend/ingest.py

# Re-roll the mocked QA data (deterministic — same output every run), then load it.
mock:
	node scripts/generate-mock.ts
	$(MAKE) ingest

clean:
	rm -rf .artifacts .playwright-cli backend/__pycache__
