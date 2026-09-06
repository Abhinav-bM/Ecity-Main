#!/usr/bin/env bash
# Rebuild and restart the local app, waiting for the port to actually free and
# for the app to actually answer. Starting before the old process has released
# port 3000 leaves the OLD build serving requests, which produces test failures
# that look like application bugs.
set -euo pipefail

PORT="${PORT:-3000}"
LOG="${LOG:-/tmp/ecity-server.log}"

echo "› stopping anything on :$PORT"
lsof -ti:"$PORT" | xargs kill -9 2>/dev/null || true
for _ in $(seq 1 30); do
  lsof -ti:"$PORT" >/dev/null 2>&1 || break
  sleep 0.5
done
if lsof -ti:"$PORT" >/dev/null 2>&1; then
  echo "✗ port $PORT is still held" >&2
  exit 1
fi

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "› building"
  rm -rf .next
  npm run build 2>&1 | grep -E "✓ Compiled|Failed to compile" || true
fi

echo "› starting"
npm start > "$LOG" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 60); do
  # A dead starter means the health check below would be answering from some
  # other process - an older build that never released the port. That produced
  # a whole test run against stale code once, so treat it as fatal.
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "✗ the server process exited during startup. Log:" >&2
    tail -20 "$LOG" >&2
    exit 1
  fi
  if curl -fsS -m 2 "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    echo "✓ up (pid $SERVER_PID): $(curl -s "http://localhost:$PORT/api/health")"
    exit 0
  fi
  sleep 0.5
done

echo "✗ app did not become healthy. Last log lines:" >&2
tail -20 "$LOG" >&2
exit 1
