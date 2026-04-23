# Managed Agents — Technical Handoff

This document is the authoritative spec for building the production
mirror of the current POC. It freezes the v1 schema and defines the v2
additions (P0 + P1). Any flow that validates against the v1 schema is
forward-compatible with v2 — all v2 changes are additive optional
fields.

**Implementation status** (as of commit `b0d2fc9`): v1 is stable; all
v2 features described in §9 are implemented in the POC and passing
type-check + fixture validation. Use the POC code as the reference
implementation; when the mirror diverges, the POC is authoritative for
behavior.

---

## 1. System overview

Managed Agents is an orchestration + governance framework for Claude
managed agents. A user declares a **workflow** (directed graph of
nodes), kicks off a **run**, and the executor walks the graph,
instantiating **managed agent sessions** at agent nodes and
checkpointing every step to the DB.

The app exposes workflows three ways:

1. **Web UI** — React/MUI flow editor + Run History
2. **MCP (HTTP streamable-http)** — Cowork / Claude Code / Claude
   Desktop can list/describe/start workflows and inspect runs
3. **Direct REST API** — `/api/runs`, `/api/workflows`, etc.

Every run produces an auditable trace: `WorkflowRun → RunStep[] →
RunEvent[]`. Agent configs are append-only-versioned so old runs can be
reconstructed even after the workflow is edited many times.

---

## 2. Tech stack (mirror as-is unless noted)

- **Runtime**: Node.js ≥ 18, TypeScript, Express 4
- **Client**: Vite + React 18 + MUI + React Flow (editor) + React Router
- **DB**: PostgreSQL via Prisma (earlier POC used SQLite; do NOT
  replicate — Postgres is required for concurrent step updates)
- **Managed Agents**: `@anthropic-ai/sdk` ≥ 0.90.0 (beta API)
- **MCP**: `@modelcontextprotocol/sdk` ≥ 1.29, streamable-http transport
- **Salesforce**: `jsforce` 3.x with JWT bearer OAuth (private key in
  env, Connected App with pre-authorized profile)
- **Deployment**: Render (single web service; DB is a Render Postgres)

Model defaults: **`claude-opus-4-7`** everywhere. `effort` controls
cost/quality (`low` | `medium` | `high` | `xhigh` | `max`). Do NOT
pass `temperature` (deprecated on this model family — 400 from the
API). Do NOT pass `speed: fast` on Opus (Sonnet/Haiku only).

---

## 3. Database schema

```prisma
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }
generator client { provider = "prisma-client-js" }

model Workflow {
  id         String   @id @default(cuid())
  name       String
  schemaJson String   @map("schema_json")       // full WorkflowSchema
  version    Int      @default(1)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @default(now())
  runs       WorkflowRun[]
  agents     Agent[]
}

/// Versioned per-node managed-agent config history.
/// All rows for the same (workflowId, nodeId) SHARE one anthropicAgentId.
/// supersededAt IS NULL  → this row's config is what's currently applied
///                         on the Anthropic agent.
model Agent {
  id               String    @id @default(cuid())
  workflowId       String
  nodeId           String
  version          Int                           // 1, 2, 3... per (workflow, node)
  configHash       String                        // sha256 of stable-stringified identity
  configJson       String                        // full snapshot for revival
  anthropicAgentId String                        // stable across versions
  createdAt        DateTime  @default(now())
  supersededAt     DateTime?
  runSteps         RunStep[]

  @@unique([workflowId, nodeId, version])
  @@unique([workflowId, nodeId, configHash])    // dedup: same hash → reuse row
}

model WorkflowRun {
  id          String    @id @default(cuid())
  workflowId  String
  status      String    @default("pending")     // pending | running | completed | failed | cancelled (v2)
  inputJson   String    @default("{}")
  startedAt   DateTime?
  completedAt DateTime?
  createdAt   DateTime  @default(now())
  steps       RunStep[]
  events      RunEvent[]
}

model RunStep {
  id             String    @id @default(cuid())
  runId          String
  nodeId         String
  status         String    @default("running")  // running | completed | failed | awaiting_approval
  inputJson      String?
  outputJson     String?
  errorMessage   String?
  errorStack     String?
  agentSessionId String?                        // Anthropic session id
  agentId        String?                        // FK to Agent row (which config ran this step)
  startedAt      DateTime  @default(now())
  completedAt   DateTime?
  approvals     Approval[]
}

model RunEvent {
  id        String   @id @default(cuid())
  runId     String
  stepId    String?
  eventType String                                // see event list below
  payload   String   @default("{}")
  createdAt DateTime @default(now())
}

model Approval {
  id           String   @id @default(cuid())
  stepId       String
  slackChannel String?
  slackUserId  String?
  decision     String?                           // pending | approved | rejected | <custom label>
  comment      String?
  createdAt    DateTime @default(now())
}
```

**Indexes that matter**: `agents(workflow_id, node_id, config_hash)`
unique, `run_steps(run_id)`, `run_events(run_id)`.

**Output truncation**: persist `outputJson` up to 100 KB. Over that,
replace with `{ _truncated: true, preview: "<first 4KB>", size: N }`.

**Orphan recovery**: on server boot, run
`UPDATE workflow_runs SET status='failed' WHERE status IN ('pending','running')`
and emit a `server_restart` event for each. A run that was mid-flight
when the server died is not resumable (no step checkpoint replay in v1 —
see v2 note below).

---

## 4. WorkflowSchema v1 spec

Every workflow JSON conforms to:

```ts
interface WorkflowSchema {
  id:          string;       // must start with "wf-" and be unique
  name:        string;
  version:     string;       // "1.0" for v1, "2.0" for v2 features
  entryNodeId: string;       // must reference a node
  nodes:       WorkflowNode[];
  edges:       WorkflowEdge[];
}

interface WorkflowNode {
  id:          string;       // unique within workflow
  type:        "input" | "agent" | "gate" | "router" | "human_gate" | "finalize";
  name:        string;
  config:      <see per-type configs below>;
  modelConfig?: ModelConfig;  // agent nodes only
}

interface WorkflowEdge {
  id:        string;
  source:    string;          // node id
  target:    string;          // node id
  condition?: string;         // required when source is gate/router/human_gate
}

interface ModelConfig {
  model?:     string;         // default "claude-opus-4-7"
  maxTokens?: number;
  effort?:    "low" | "medium" | "high" | "xhigh" | "max";
  speed?:     "standard" | "fast";  // only on Sonnet/Haiku
}
```

### Node configs

**input**
```ts
{
  description?: string;       // shown in UX
  fields: Record<string, {
    description?: string;
    type?: "string" | "number" | "boolean" | "url" | "email" | "date";
    required?: boolean;
    example?: string;
  }>;
  requiredFields?: string[];  // legacy, keep supporting
}
```

**agent** (the workhorse)
```ts
{
  instructions:   string;                       // non-empty
  inputMapping?:  Record<string, string>;       // "var": "$.run.input.x" or "$.steps.n.outputs.y"
  timeoutSeconds?: number;                      // default 300
  outputFormat?:  "text" | "json";              // "json" → executor parses response into outputs.parsed
  mcpServers?:    { name: string; type: "url"; url: string }[];
  tools?:         { type: string; [k: string]: unknown }[];   // pass-through to beta.agents.create
  skills?:        { type: "anthropic"; skill_id: string }[];
  includeSalesforceTools?:  boolean;            // shorthand: inject SF_TOOL_DEFINITIONS
  includeFlowBuilderTools?: boolean;            // shorthand: inject FLOW_BUILDER_TOOL_DEFINITIONS
}
```

**gate** — deterministic boolean branch
```ts
{
  expression: string;         // evaluated against { input, steps }
                              // e.g. "steps.reader.outputs.parsed.score > 0.8"
                              // allowed refs: input.<field>, steps.<id>.outputs.<path>
}
```
Gate nodes MUST have exactly two outgoing edges with
`condition: "true"` and `condition: "false"`.

**router** — LLM-classified multi-way branch
```ts
{
  instructions:  string;
  labels:        string[];
  inputMapping?: Record<string, string>;
  model?:        string;      // defaults to a cheap model
}
```
Every outgoing edge must have `condition` matching one of `labels`.

**human_gate** — Slack approval
```ts
{
  channel:         string;                      // e.g. "#approvals"
  messageTemplate: string;                      // supports {{input.*}}, {{steps.*}}
  decisionValues:  string[];                    // button labels; also the edge conditions
  timeoutSeconds?: number;                      // default 600
  approver?:       string;                      // display only
  icon?:           string;                      // display only
}
```

**finalize** — exactly ONE per workflow, sink node
```ts
{
  summaryFields?: string[];   // field names to include in run output
  slackChannel?:  string;     // optional Block Kit summary
  slackTitle?:    string;     // template
}
```

### Validation rules (enforce at save time)

- Exactly one `input` node, exactly one `finalize` node
- `entryNodeId` references an `input` node
- Every edge `source`/`target` references an existing node
- Gate: exactly 2 outgoing edges, conditions "true" and "false"
- Router: every outgoing edge's condition is in `labels`
- Human gate: every outgoing edge's condition is in `decisionValues`
- Agent: `instructions` non-empty
- Collect ALL errors, don't short-circuit

---

## 5. Executor semantics

**Algorithm** (parallel DAG walker):

```
edgeAlive[e]     = true for every edge initially
nodePendingIn[n] = count of incoming edges
nodeState[n]     = "pending"
nodeState[entry] = "pending" with nodePendingIn = 0

while there is a pending node with nodePendingIn === 0:
  ready = all such nodes
  Promise.all(ready.map(runNode))
  for each completed node:
    if gate/router/human_gate:
      kill non-chosen outgoing edges
      (a dead edge propagates: if its target loses all live incoming
       edges, mark target "pruned" and kill its outgoing edges too)
    for each LIVE outgoing edge:
      decrement target's nodePendingIn
  hit MAX_STEPS=100 → emit max_steps_exceeded, fail run
  any step failed → mark run failed, cancel pending, stop
```

**Run lifecycle statuses**:
`pending → running → (completed | failed | cancelled)`. `cancelled` is
v2 only.

**Step lifecycle**: `running → (completed | failed |
awaiting_approval)`. `awaiting_approval` only for human_gate while
polling Slack.

**Events emitted** (eventType values):
- `workflow_started` — `{ workflowId, workflowName, entryNode, inputKeys }`
- `step_started` — `{ nodeId, nodeType, nodeName }`
- `step_completed` — `{ nodeId, outputKeys }`
- `step_failed` — `{ nodeId, message }`
- `workflow_completed` — `{ summary }`
- `error` — `{ message, stack }`
- `max_steps_exceeded` — `{ totalExecuted }`
- `server_restart` — `{}`

**Context resolution** (two syntaxes, both supported):
- `inputMapping` values: `"$.run.input.<field>"` or
  `"$.steps.<nodeId>.outputs.<path>"` — parsed by `resolveInputMapping`.
  Path supports dotted access (`.parsed.score`).
- Inline templates in `messageTemplate` / `slackTitle`:
  `{{input.foo}}`, `{{steps.foo.outputs.bar}}` — `substituteTemplate`.

**Agent output handling**: when `outputFormat === "json"`, the executor
tries `JSON.parse(response)`; on success stores in
`outputs.parsed`, on failure logs warning but keeps `outputs.text`.

---

## 6. Managed Agents API usage

We use `@anthropic-ai/sdk` beta surface. Key calls:

```ts
// Create environment once per app (cached in-process singleton)
anthropic.beta.environments.create({
  name: "managed-agents-poc-env",
  config: { type: "cloud", networking: { type: "unrestricted" } }
})

// Create an agent (first time a node is seen)
anthropic.beta.agents.create({
  name, model, system, tools?, mcp_servers?, skills?
})

// Update an agent in place (on subsequent config changes)
const cur = await anthropic.beta.agents.retrieve(agentId);
anthropic.beta.agents.update(agentId, {
  version: cur.version, name, model, system, tools, mcp_servers, skills
})

// Create a session per run-step
const session = await anthropic.beta.sessions.create({
  agent: agentId, environment_id, title
})

// Send user message
anthropic.beta.sessions.events.send(session.id, {
  events: [{ type: "user.message", content: [{ type: "text", text }] }]
})

// Stream events until stop_reason === "end_turn"
for await (const e of anthropic.beta.sessions.events.stream(session.id)) {
  ... handle agent.message / agent.custom_tool_use /
      session.status_idle / session.error ...
}
```

### Agent Registry — the single most important subsystem

Rules:

1. **One Anthropic agent per (workflowId, nodeId)**, not per config
   change, not per run.
2. First-ever config for a node: `beta.agents.create` → save Agent row
   with that `anthropicAgentId`, `version = 1`, `supersededAt = null`.
3. Subsequent NEW config for the same node:
   `beta.agents.retrieve(id)` to get current Anthropic version, then
   `beta.agents.update(id, { version: current.version, ...identity })`.
   Mark prior Agent rows superseded, insert new row with the SAME
   `anthropicAgentId` and bumped `version`.
4. Re-seen config (configHash collides with an existing row): reuse that
   row. If it's superseded, re-apply it via `update` and flip
   supersededAt back to null.
5. Race: if two calls insert the same new `configHash` and one loses on
   the unique index, refetch the winner.

The `configHash` covers only identity-affecting fields —
**instructions, model, speed, mcpServers, tools (post-expansion),
skills**. Execution-time fields (`inputMapping`, `timeoutSeconds`,
`outputFormat`) MUST NOT be part of the hash.

Use **stable JSON stringification** (sort object keys at every level,
preserve array order) before hashing — otherwise the hash flaps and
you regenerate agents on every save.

**Reviving a past run's config** = re-apply that row's `configJson`
via `beta.agents.update` to the shared agent id. The id doesn't
change; Anthropic's native versioning bumps one.

**Custom-tool expansion**: shorthand flags (`includeSalesforceTools`,
`includeFlowBuilderTools`) get expanded to full tool arrays BEFORE
hashing. Keep the expansion function pure and deterministic.

---

## 7. MCP server

Transport: `StreamableHTTPServerTransport` from
`@modelcontextprotocol/sdk`, stateless mode
(`sessionIdGenerator: undefined, enableJsonResponse: true`), mounted at
`POST /mcp`.

A fresh `McpServer` + transport is constructed per request (registering
tools is cheap; there's no cross-request state).

Tools exposed (names are load-bearing — Cowork / Claude Code cache them):

| Name | Purpose |
|------|---------|
| `list_workflows` | Workflow catalog (id, name, description) |
| `describe_workflow` | Full schema + input spec for a given id |
| `start_workflow` | Kick off a run; returns `{ runId }` |
| `get_run_status` | Current status + step-by-step progress |
| `list_runs` | 10 most recent runs |
| `create_workflow` | Publish a new workflow (same path as the flow-builder agent's `save_workflow` tool) |
| `salesforce_concierge` | Natural-language Salesforce operations (thin wrapper that starts `wf-concierge`) |

Input schemas are Zod shapes passed as the third arg of `server.tool`.
Use the MCP SDK's `.shape` property, not raw Zod — the SDK transforms
the rest.

**Do NOT return session tokens or polling instructions in tool
responses**. Long-running tools should either (a) long-poll internally
up to a cap then return final text, or (b) use v2 async mode (see §9).

---

## 8. Custom tool dispatch architecture

Anthropic dispatches `agent_toolset_20260401` and MCP-based tools
server-side — we never see those calls. What we dispatch locally are
**custom tools** (`type: "custom"`) declared in the agent config.

Pattern:

```ts
// src/tools/<domain>.ts
export const <DOMAIN>_TOOL_DEFINITIONS = [ { type: "custom", name, description, input_schema }, ... ];
export const <DOMAIN>_TOOL_NAMES = new Set(<DOMAIN>_TOOL_DEFINITIONS.map(t => t.name));
export async function dispatch<Domain>Tool(name: string, input: Record<string, unknown>): Promise<string> {
  // return a STRING (JSON-stringified payload) — Anthropic expects text
}
```

In `agentNodeHandler.ts`, the session loop receives
`agent.custom_tool_use` events. When the session emits
`session.status_idle` with `stop_reason: "requires_action"`, we
dispatch each queued call in parallel and send the results as
`user.custom_tool_result` events.

**Existing domains**:
- `src/tools/salesforce.ts` — `sf_query`, `sf_describe`, `sf_create`,
  `sf_update`, `sf_upsert`, `sf_chatter`, `sf_watch_chatter`
  (jsforce-backed, JWT auth, one cached Connection per process)
- `src/tools/flowBuilder.ts` — `save_workflow`, `list_existing_workflows`
  (validates + writes to Workflow table)

Adding a domain = (1) define the tool defs + dispatcher, (2) register
the name set in the handler's dispatch switch, (3) optionally add an
`includeXTools` shorthand to `AgentNodeConfig` + `expandTools`.

---

## 9. Schema v2 — P0 and P1 additions (freeze now)

All v2 additions are **optional fields on existing types** or **new
optional top-level fields**. v1 workflows (schemas with `version: "1.0"`
and none of these fields) validate and run unchanged.

### 9.1 P0 — must land in v2

**Async completion & notify-on-done** (new top-level)
```ts
interface WorkflowSchema {
  ...
  completion?: {
    mode?: "sync" | "async";                  // default "sync"
    notify?: {
      slackChannel?: string;
      slackUserId?:  string;
      webhookUrl?:   string;
      email?:        string;
    };
  };
}
```
Per-run override via `POST /api/runs { workflowId, input, notify?, async? }`.
When `mode === "async"`, `start_workflow` MCP tool returns immediately
with `{ runId, status: "running" }`. On terminal status (completed /
failed), the executor fires notify targets with a signed payload
`{ runId, status, workflowId, summary, url }`.

**Retries with backoff** (new per-node field)
```ts
interface NodeConfig {
  ...
  retry?: {
    maxAttempts?:       number;               // default 1 (no retry)
    initialDelayMs?:    number;               // default 1000
    backoffMultiplier?: number;               // default 2
    retryOn?: ("timeout" | "tool_error" | "rate_limit" | "http_5xx")[];
  };
}
```
Applies to agent, router, gate. Executor wraps `runHandler` in a retry
loop; logs each attempt as a separate `step_retry` event.

**Run cancellation** (no schema change)
- New endpoint: `POST /api/runs/:id/cancel`
- Executor checks a `cancelRequested` flag between steps
- Cancelled runs: status = `"cancelled"`, unfinished steps = `"cancelled"`

**Validator tightening**
- Enforce gate edge conditions (`true`/`false` exactly)
- Enforce router edge conditions match declared `labels`
- Enforce human_gate edge conditions match `decisionValues`
- Remove the incorrect "reserved for future" comment in `types.ts`

### 9.2 P1 — also ships in v2

**Sub-workflow invocation** (new node type)
```ts
interface SubflowNodeConfig {
  workflowId:         string;                 // the child workflow id
  inputMapping?:      Record<string, string>;
  waitForCompletion?: boolean;                // default true; false = fire-and-forget
  propagateFailure?:  boolean;                // default true
}

type NodeType = ... | "subflow";
```
Executor creates a child `WorkflowRun` with `parentRunId`
(new nullable FK on `WorkflowRun`). When `waitForCompletion`, parent
blocks until child terminates; outputs flow back as
`steps.<subflowNodeId>.outputs`.

**Map / fan-out over a list** (new node type)
```ts
interface MapNodeConfig {
  over:        string;                        // $-path to array in context
  itemVar:     string;                        // name injected into iteration context
  bodyNodeId:  string;                        // any node id in the same workflow
  concurrency?: number;                       // default 10
  failFast?:   boolean;                       // default false — collect all results
}

type NodeType = ... | "map";
```
Executor instantiates N copies of `bodyNodeId` with distinct contexts
(each sees `$.item.<itemVar>`). Outputs aggregate into
`outputs.results: Array<StepResult>`. `bodyNodeId` must not have other
inbound edges in the static graph — it's a template.

**Triggers** (new top-level)
```ts
interface WorkflowSchema {
  ...
  triggers?: {
    cron?:    string;                         // "0 9 * * MON"
    webhook?: { path: string; secret?: string }; // auto-register POST /triggers/:path
  };
}
```
A separate scheduler process reads `triggers.cron` across all workflows
on startup + on every workflow save; submits runs at the scheduled time
with an empty input (trigger workflows should use default fields).

**Token / cost / duration budgets** (new top-level)
```ts
interface WorkflowSchema {
  ...
  budget?: {
    maxTokens?:          number;
    maxCostUsd?:         number;
    maxDurationSeconds?: number;
  };
}
```
Executor tallies per-step token usage from Anthropic responses (`usage`
field). On overage: emit `budget_exceeded` event, mark run failed,
cancel pending steps.

### 9.3 Compat contract

- The validator accepts any v1 schema verbatim as v2. The only places
  the `version` field matters: the stricter edge-condition rules apply
  to `version: "2.0"` workflows but are also reported as warnings on
  `"1.0"` (don't fail).
- The `configHash` inputs are FROZEN at the v1 set
  (`instructions, model, speed, mcpServers, tools, skills`). v2 fields
  like `retry`, `completion`, `budget` MUST NOT enter the hash —
  they're execution-time, not identity.
- Existing fixtures in this repo are the ground-truth test set. Pull
  them into the mirror's CI and require them to validate + execute
  through `finalize` before any schema change ships.

---

## 10. Environment variables

Mirror needs:
```
ANTHROPIC_API_KEY          # required
DATABASE_URL               # postgres://...
SF_CLIENT_ID               # Salesforce Connected App consumer key
SF_USERNAME                # SF user whose access we assume
SF_PRIVATE_KEY             # PEM; Render escapes \n — unescape at boot
SF_LOGIN_URL               # default https://login.salesforce.com
SLACK_BOT_TOKEN            # optional, enables human_gate + finalize.slack
SLACK_SIGNING_SECRET       # optional
PORT                       # Render sets this
NODE_ENV                   # "production" in Render
```

---

## 11. Non-obvious gotchas (the things that cost us time)

1. **Temperature is rejected on Opus 4.7.** Remove it from every
   `messages.create` call. Opus uses `effort` instead.
2. **`speed: fast` is Sonnet/Haiku only.** Passing it to Opus 4.7 →
   400.
3. **`configHash` stability is do-or-die.** The POC had duplicates
   piling up because the hash flapped when any execution-time field
   leaked in. Keep the identity TS-enforced via a dedicated
   `AgentIdentity` type; never spread `...config` into it.
4. **`beta.agents.update` requires the current version field.** Always
   `retrieve` first, then `update` — optimistic-locked. On 409, retry
   once (the other writer landed).
5. **Anthropic agents don't hard-delete.** Use `archive`. Archived
   agents keep existing sessions working; new sessions against them
   fail.
6. **MCP tool list is cached client-side.** Renaming or removing a
   tool requires the Cowork connector to reconnect. Prefer additive
   changes.
7. **Render escapes newlines in env vars.** `SF_PRIVATE_KEY` arrives
   as `\\n`-escaped; un-escape at boot: `key.replace(/\\n/g, "\n")`.
8. **SQLite won't handle the step-update concurrency.** Use Postgres
   from day one.
9. **Human-gate polls Slack.** If the Slack token is missing, the gate
   degrades to a time-based pass-through (documented in handler;
   auto-approves after `timeoutSeconds` for POC demoability — v2
   should fail-closed by default with an opt-in flag).
10. **Output truncation at 100KB** — Opus can emit multi-MB JSON
    artifacts and fill Postgres TEXT columns. Enforce the cap in
    `completeRunStep`.

---

## 12. Directory layout (mirror this)

```
src/
  server.ts                     # Express app + route mounting
  config/anthropic.ts           # SDK client singleton
  db/client.ts                  # Prisma client
  api/
    runRoutes.ts                # POST /api/runs, GET /api/runs, etc.
    workflowRoutes.ts
    approvalRoutes.ts
    slackRoutes.ts
    diagRoutes.ts
  agent/
    managedAgentSetup.ts        # environment singleton
    orchestrator.ts             # /api/chat → wf-flow-builder
    salesforceConcierge.ts      # /api/concierge → wf-concierge
  mcp/
    httpHandler.ts              # POST /mcp (streamable-http)
  tools/
    salesforce.ts               # SF custom tools
    flowBuilder.ts              # save_workflow, list_existing_workflows
  workflow/
    types.ts                    # schema TS types
    schemaValidator.ts          # validation
    executor.ts                 # DAG walker
    persistence.ts              # DB writes
    agentRegistry.ts            # findOrCreateAgent (§6.1)
    resolveInputMapping.ts      # $-path + {{template}} resolver
    renderMermaid.ts            # for run visualization
    nodeHandlers/
      index.ts                  # getNodeHandler(nodeType)
      inputNodeHandler.ts
      agentNodeHandler.ts       # §7 custom tool dispatch
      gateNodeHandler.ts
      routerNodeHandler.ts
      humanGateNodeHandler.ts
      finalizeNodeHandler.ts
      # v2 additions:
      # subflowNodeHandler.ts
      # mapNodeHandler.ts
    fixtures/
      flowBuilder.json
      salesforceConcierge.json
      incidentCommander.json
      dealDesk.json
      tpsReport.json
      customerOnboarding.json
      wealthIntake.json
      humanGateSmoke.json
      logNewOpportunity.json
  scripts/
    seedDemoWorkflows.ts
    reconcileAgents.ts          # archive orphan Anthropic agents
prisma/
  schema.prisma
  migrations/
```

---

## 13. Migration plan from POC to mirror

1. Stand up the mirror on an empty Postgres DB with the schema above
   (run the init migration).
2. Import fixtures unchanged (`npm run seed:demos`). They validate.
3. Leave the `agents` table empty — the registry will populate it
   lazily on first run per node. This avoids inheriting any cruft from
   the POC's DB.
4. Before declaring the mirror done, run each fixture to `completed`
   status once. If any fails validation or execution, that's a parity
   bug.
5. Implement P0 (retry, cancel, notify-on-done, validator
   tightening) — tests: a workflow with a retry-3 agent that fails
   twice then succeeds; a flow started with `async: true` verifying
   the webhook fires; a cancel mid-human-gate.
6. Implement P1 (subflow, map, trigger, budget) — tests: a `map` over
   a 5-item list running in parallel; a cron-triggered workflow; a
   subflow-calling-subflow pair with shared input.
7. Export workflows from POC, import into mirror, re-run — zero
   behavior change for v1 fixtures.

---

## 14. References in the POC codebase

- Agent registry: `src/workflow/agentRegistry.ts`
- Executor: `src/workflow/executor.ts`
- MCP tools: `src/mcp/httpHandler.ts`
- Salesforce tools: `src/tools/salesforce.ts`
- Flow builder tools: `src/tools/flowBuilder.ts`
- Schema validator: `src/workflow/schemaValidator.ts`
- Input resolver: `src/workflow/resolveInputMapping.ts`
- Fixtures (ground-truth test set): `src/workflow/fixtures/*.json`

The mirror should treat the fixtures as a regression suite; a fixture
that fails to run identically on the mirror is a bug in the mirror.
