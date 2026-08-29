#!/bin/sh
set -eu

PORT="${RECONCILIATION_TEST_PORT:-$((44000 + ($$ % 1000)))}"
ORIGIN="http://127.0.0.1:${PORT}"
EMAIL_CODE="${EMAIL_VERIFICATION_TEST_CODE:-654321}"
PHONE_CODE="${PHONE_VERIFICATION_TEST_CODE:-246810}"
LOG_FILE="${TMPDIR:-/tmp}/reconciliation-api-test-$$.log"
cleanup() { [ "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true; [ "${SERVER_PID:-}" ] && wait "$SERVER_PID" 2>/dev/null || true; rm -f "$LOG_FILE"; }
trap cleanup EXIT INT TERM
pnpm --filter @workspace/db run push
pnpm run build
NODE_ENV=test PORT="$PORT" EMAIL_VERIFICATION_TEST_CODE="$EMAIL_CODE" PHONE_VERIFICATION_TEST_CODE="$PHONE_CODE" node ./dist/index.mjs >"$LOG_FILE" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 100); do curl --silent --fail --output /dev/null "$ORIGIN/api/healthz" && break; kill -0 "$SERVER_PID" 2>/dev/null || { cat "$LOG_FILE" >&2; exit 1; }; sleep .1; done
curl --silent --fail --output /dev/null "$ORIGIN/api/healthz" || { cat "$LOG_FILE" >&2; exit 1; }
NODE_ENV=test EMAIL_VERIFICATION_TEST_CODE="$EMAIL_CODE" PHONE_VERIFICATION_TEST_CODE="$PHONE_CODE" RECONCILIATION_TEST_ORIGIN="$ORIGIN" node --test test/reconciliation-aging.test.mjs