#!/bin/sh
set -eu

PORT="${INVENTORY_TEST_PORT:-$((43000 + ($$ % 1000)))}"
ORIGIN="http://127.0.0.1:${PORT}"
EMAIL_CODE="${EMAIL_VERIFICATION_TEST_CODE:-654321}"
PHONE_CODE="${PHONE_VERIFICATION_TEST_CODE:-246810}"
LOG_FILE="${TMPDIR:-/tmp}/inventory-api-test-$$.log"

cleanup() {
  if [ "${SERVER_PID:-}" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$LOG_FILE"
}
trap cleanup EXIT INT TERM

pnpm --filter @workspace/db run push
pnpm run build

NODE_ENV=test \
PORT="$PORT" \
EMAIL_VERIFICATION_TEST_CODE="$EMAIL_CODE" \
PHONE_VERIFICATION_TEST_CODE="$PHONE_CODE" \
node ./dist/index.mjs >"$LOG_FILE" 2>&1 &
SERVER_PID=$!

ready=0
for _attempt in $(seq 1 100); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    cat "$LOG_FILE" >&2
    exit 1
  fi
  if curl --silent --fail --output /dev/null "$ORIGIN/api/healthz"; then
    ready=1
    break
  fi
  sleep 0.1
done
if [ "$ready" -ne 1 ]; then
  cat "$LOG_FILE" >&2
  echo "Inventory test API did not become ready." >&2
  exit 1
fi

NODE_ENV=test \
EMAIL_VERIFICATION_TEST_CODE="$EMAIL_CODE" \
PHONE_VERIFICATION_TEST_CODE="$PHONE_CODE" \
INVENTORY_TEST_ORIGIN="$ORIGIN" \
LOCATION_SCOPE_TEST_ORIGIN="$ORIGIN" \
BACKUP_TEST_ORIGIN="$ORIGIN" \
QUOTATION_TEST_ORIGIN="$ORIGIN" \
PURCHASE_ORDER_TEST_ORIGIN="$ORIGIN" \
node --test test/inventory-concurrency.test.mjs test/location-scope-products.test.mjs test/backup-restore.test.mjs test/quotation-flow.test.mjs test/purchase-order-flow.test.mjs