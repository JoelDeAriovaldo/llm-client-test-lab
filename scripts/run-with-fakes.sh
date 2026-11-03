#!/usr/bin/env bash
# Runs the whole app against fake services, with its own throwaway database.
# Needs no real keys, and nothing reaches the real Marking Lab.
set -euo pipefail
export LAB_DB_PATH="${LAB_DB_PATH:-$(mktemp -d)/fake-lab.db}"
export MARKING_LAB_URL=http://127.0.0.1:4010/api
export MARKING_LAB_KEY=msk_test
echo "Database: $LAB_DB_PATH"
npx tsx scripts/migrate.ts
npx concurrently -k -n fakes,web,worker \
  "npx tsx tests/fakes/serve.ts" \
  "npx next dev -H 127.0.0.1 -p 3100" \
  "npx tsx src/worker/index.ts"
