#!/usr/bin/env bash
# Smoke tests for /api/runs endpoints
# Depends on a workflow existing — run workflows.sh first or supply WORKFLOW_ID.
# Usage: bash scripts/smoke/runs.sh [BASE_URL] [WORKFLOW_ID]

set -euo pipefail

BASE="${1:-http://localhost:5001}"
PASS=0
FAIL=0

ok()   { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1"; }

echo "=== Run Smoke Tests ==="
echo "Base URL: $BASE"

# ── Ensure a workflow exists ────────────────────────────────────────
if [ -n "${2:-}" ]; then
  WF_ID="$2"
  echo "Using provided workflow: $WF_ID"
else
  echo "Creating a test workflow..."
  RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/workflows" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "Run Smoke Workflow",
      "schema": {
        "schemaVersion": "1.0",
        "flowId": "run-smoke-wf",
        "name": "Run Smoke",
        "entryNodeId": "input-1",
        "nodes": [
          { "id": "input-1", "type": "input", "name": "Start", "config": {} },
          { "id": "agent-1", "type": "agent", "name": "Agent", "config": { "instructions": "Echo input" } },
          { "id": "final-1", "type": "finalize", "name": "Done", "config": {} }
        ],
        "edges": [
          { "from": "input-1", "to": "agent-1" },
          { "from": "agent-1", "to": "final-1" }
        ]
      }
    }')
  HTTP_CODE=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | sed '$d')
  # Accept 201 (new) or 409 (already exists)
  WF_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ -z "$WF_ID" ]; then
    WF_ID="run-smoke-wf"
  fi
  echo "  Using workflow: $WF_ID"
fi
echo ""

# ── 1. POST /api/runs — valid ──────────────────────────────────────
echo "1. POST /api/runs (valid)"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/runs" \
  -H "Content-Type: application/json" \
  -d "{\"workflowId\": \"$WF_ID\", \"input\": {\"message\": \"hello\"}}")

HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" = "202" ]; then ok "Status 202 Accepted"; else fail "Expected 202, got $HTTP_CODE"; fi

RUN_ID=$(echo "$BODY" | grep -o '"runId":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "$RUN_ID" ]; then ok "Has runId: $RUN_ID"; else fail "Missing runId"; fi

if echo "$BODY" | grep -q '"status":"pending"'; then ok "status=pending"; else fail "Expected status=pending"; fi
echo ""

# ── 2. POST /api/runs — missing workflow ────────────────────────────
echo "2. POST /api/runs (missing workflow)"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/runs" \
  -H "Content-Type: application/json" \
  -d '{"workflowId": "does-not-exist-xyz", "input": {}}')

HTTP_CODE=$(echo "$RESP" | tail -1)

if [ "$HTTP_CODE" = "404" ]; then ok "Status 404"; else fail "Expected 404, got $HTTP_CODE"; fi
echo ""

# ── 3. GET /api/runs ────────────────────────────────────────────────
echo "3. GET /api/runs"
RESP=$(curl -s -w "\n%{http_code}" "$BASE/api/runs")

HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then ok "Status 200"; else fail "Expected 200, got $HTTP_CODE"; fi
if echo "$BODY" | grep -q '"runs"'; then ok "Has 'runs' array"; else fail "Missing 'runs'"; fi
if echo "$BODY" | grep -q '"workflowName"'; then ok "Has 'workflowName'"; else fail "Missing 'workflowName'"; fi
echo ""

# ── 4. GET /api/runs/:id ───────────────────────────────────────────
if [ -n "$RUN_ID" ]; then
  echo "4. GET /api/runs/$RUN_ID"
  RESP=$(curl -s -w "\n%{http_code}" "$BASE/api/runs/$RUN_ID")

  HTTP_CODE=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | sed '$d')

  if [ "$HTTP_CODE" = "200" ]; then ok "Status 200"; else fail "Expected 200, got $HTTP_CODE"; fi
  if echo "$BODY" | grep -q '"steps"'; then ok "Has 'steps'"; else fail "Missing 'steps'"; fi
  if echo "$BODY" | grep -q '"events"'; then ok "Has 'events'"; else fail "Missing 'events'"; fi
  echo ""

  # ── 5. Poll for status transition ──────────────────────────────────
  echo "5. Polling run status (up to 15s)..."
  for i in $(seq 1 5); do
    sleep 3
    RESP=$(curl -s "$BASE/api/runs/$RUN_ID")
    STATUS=$(echo "$RESP" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
    echo "  Poll $i: status=$STATUS"
    if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
      ok "Reached terminal state: $STATUS"
      break
    fi
    if [ "$i" -eq 5 ]; then
      echo "  ⚠️  Still '$STATUS' after 15s (executor may be disabled or slow — not a failure)"
    fi
  done
  echo ""
else
  echo "4. Skipping GET /runs/:id — no run ID available"
  echo ""
fi

# ── Summary ─────────────────────────────────────────────────────────
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
