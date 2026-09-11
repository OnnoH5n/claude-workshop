.PHONY: dev test test-ci check reset mock clean

# Start the app + API on one port. Serve over HTTP — never open index.html as file://.
dev:
	@mkdir -p .artifacts
	npm run dev

# Headed by default so the room can watch the tests drive the real UI.
test:
	PLAYWRIGHT_HTML_OPEN=never npx playwright test --headed --workers=1

test-ci:
	PLAYWRIGHT_HTML_OPEN=never npx playwright test

check:
	npm run typecheck
	PLAYWRIGHT_HTML_OPEN=never npx playwright test

# Restore the demo to the committed known-good state.
reset:
	rm -f data/store.json
	@curl -s -o /dev/null localhost:5173/api/reset 2>/dev/null || true
	@echo "portfolio reset to data/seed.json"

# Re-roll the mocked QA data (deterministic — same output every run).
mock:
	node scripts/generate-mock.ts

clean:
	rm -rf .artifacts .playwright-cli data/store.json
