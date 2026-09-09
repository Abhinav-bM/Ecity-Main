#!/usr/bin/env bash
# Run the browser tests against a FRESH, seeded database — the conditions CI
# uses.
#
# Why this exists: the development database accumulates data from every test
# run, and that extra data masks real bugs. A branch-wise panel that only
# renders when two branches have activity looked fine locally, where dozens of
# branches had data, and vanished in CI where the seed creates two. Testing
# only against the dev database means finding these on the pipeline instead.
set -euo pipefail

DB="${CLEAN_DB:-ecity_ci}"
PORT="${PORT:-3000}"
LOG="${LOG:-/tmp/ecity-clean-db.log}"
export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH"

echo "› rebuilding $DB from scratch"
dropdb --if-exists "$DB"
createdb "$DB"

export DATABASE_URL="postgres://ecity:ecity@localhost:5432/$DB"
npm run db:migrate >/dev/null
npm run db:seed:demo >/dev/null
echo "  migrated and seeded"

echo "› stopping anything on :$PORT"
lsof -ti:"$PORT" | xargs kill -9 2>/dev/null || true
for _ in $(seq 1 30); do lsof -ti:"$PORT" >/dev/null 2>&1 || break; sleep 0.5; done

echo "› building"
npm run build 2>&1 | grep -E "✓ Compiled|Failed to compile" || true

echo "› starting against $DB"
npm start > "$LOG" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  kill -0 "$SERVER_PID" 2>/dev/null || { echo "✗ server died:"; tail -20 "$LOG"; exit 1; }
  curl -fsS -m 2 "http://localhost:$PORT/api/health" >/dev/null 2>&1 && break
  sleep 0.5
done
echo "  up"

echo "› running the browser tests"
npx playwright test "$@"
