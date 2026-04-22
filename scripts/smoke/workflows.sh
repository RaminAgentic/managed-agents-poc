#!/usr/bin/env bash
# Smoke tests for /api/workflows endpoints
# Usage: bash scripts/smoke/workflows.sh [BASE_URL]

set -euo pipefail

BASE="${1:-http://localhost:5001}"
PASS=0
FAIL=0

ok()   { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1"; }

echo "=== Workflow Smoke Tests ==="
echo "Base URL: $BASE"
echo ""

# ── 1. POST /api/workflows — valid body ─────────────────────────────
echo "1. POST /api/workflows (valid)"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/workflows" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Smoke Test Workflow",
    "schema": {
      "schemaVersion": "1.0",
      "flowId": "smoke-test-wf",
      "name": "Smoke Test",
      "entryNodeId": "input-1",
      "nodes": [
        { "id": "input-1", "type": "input", "name": "Start", "config": {} },
        { "id": "agent-1", "type": "agent", "name": "Agent", "config": { "instructions": "Do something" } },
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

if [ "$HTTP_CODE" = "201" ]; then ok "Status 201"; else fail "Expected 201, got $HTTP_CODE"; fi

# Check the response includes id, name, version, createdAt, schema
for field in id name version createdAt schema; do
  if echo "$BODY" | grep -q "\"$field\""; then
    ok "Response has '$field'"
  else
    fail "Response missing '$field'"
  fi
done

WF_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "  Created workflow: $WF_ID"
echo ""

# ── 2. POST /api/workflows — invalid body (empty nodes) ─────────────
echo "2. POST /api/workflows (invalid — empty nodes)"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/workflows" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Bad Workflow",
    "schema": { "schemaVersion": "1.0", "flowId": "bad-wf", "name": "Bad", "entryNodeId": "x", "nodes": [], "edges": [] }
  }')

HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" = "400" ]; then ok "Status 400"; else fail "Expected 400, got $HTTP_CODE"; fi
if echo "$BODY" | grep -q "details"; then ok "Has 'details'"; else fail "Missing 'details'"; fi
echo ""

# ── 3. GET /api/workflows ───────────────────────────────────────────
echo "3. GET /api/workflows"
RESP=$(curl -s -w "\n%{http_code}" "$BASE/api/workflows")

HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then ok "Status 200"; else fail "Expected 200, got $HTTP_CODE"; fi
if echo "$BODY" | grep -q "workflows"; then ok "Has 'workflows' array"; else fail "Missing 'workflows'"; fi
for field in id name version createdAt; do
  if echo "$BODY" | grep -q "\"$field\""; then
    ok "Item has '$field'"
  else
    fail "Item missing '$field'"
  fi
done
echo ""

# ── 4. GET /api/workflows/:id ──────────────────────────────────────
echo "4. GET /api/workflows/$WF_ID"
RESP=$(curl -s -w "\n%{http_code}" "$BASE/api/workflows/$WF_ID")

HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then ok "Status 200"; else fail "Expected 200, got $HTTP_CODE"; fi
if echo "$BODY" | grep -q '"schema"'; then ok "Has parsed 'schema'"; else fail "Missing 'schema'"; fi
echo ""

# ── 5. GET /api/workflows/missing-id → 404 ─────────────────────────
echo "5. GET /api/workflows/missing-id"
RESP=$(curl -s -w "\n%{http_code}" "$BASE/api/workflows/does-not-exist-xyz")

HTTP_CODE=$(echo "$RESP" | tail -1)

if [ "$HTTP_CODE" = "404" ]; then ok "Status 404"; else fail "Expected 404, got $HTTP_CODE"; fi
echo ""

# ── Summary ─────────────────────────────────────────────────────────
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
