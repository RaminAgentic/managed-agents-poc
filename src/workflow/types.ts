/**
 * Workflow Schema & Runtime types for the orchestrator engine.
 *
 * A WorkflowSchema is a directed graph of nodes connected by edges.
 * The executor walks the graph, executing each node in sequence.
 */

// ── Node types ──────────────────────────────────────────────────────

/** Supported node types in a workflow graph */
export type NodeType =
  | "input"
  | "agent"
  | "gate"
  | "router"
  | "human_gate"
  | "finalize"
  | "subflow"
  | "map";

/** Model configuration for agent nodes */
export interface ModelConfig {
  model?: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /**
   * Managed agents inference-speed knob. `fast` runs at premium pricing
   * with ~3-5x faster output generation. Not all models support it —
   * invalid combinations are rejected at agent-create time.
   */
  speed?: "standard" | "fast";
}

/** A single input field with metadata for conversational collection. */
export interface InputFieldSpec {
  /** Human-readable description of what this field is. */
  description?: string;
  /** Rough type hint — drives prompt wording and light validation. */
  type?: "string" | "number" | "boolean" | "url" | "email" | "date";
  /** If true, the workflow cannot start without this field. */
  required?: boolean;
  /** Example value to show the user / include in prompts. */
  example?: string;
}

/** Configuration specific to input nodes */
export interface InputNodeConfig {
  /** Legacy: plain field names (maintained for back-compat). */
  requiredFields?: string[];
  /** Preferred: per-field metadata. Keyed by field name. */
  fields?: Record<string, InputFieldSpec>;
  /** One-liner describing what the workflow does overall. */
  description?: string;
}

/** A remote MCP server the agent can use during its session. */
export interface AgentMcpServer {
  name: string;
  type: "url";
  url: string;
}

/** A tool entry passed to `beta.agents.create` — structural pass-through. */
export interface AgentTool {
  type: string;
  mcp_server_name?: string;
  default_config?: Record<string, unknown>;
  [key: string]: unknown;
}

/** An Anthropic-authored skill (e.g., docx, xlsx). */
export interface AgentSkill {
  type: "anthropic";
  skill_id: string;
}

/** Configuration specific to agent nodes */
export interface AgentNodeConfig {
  instructions: string;
  inputMapping?: Record<string, string>;
  timeoutSeconds?: number;
  outputFormat?: "text" | "json";
  /** Remote MCP servers to attach to this managed agent. */
  mcpServers?: AgentMcpServer[];
  /** Toolsets for the managed agent — pass-through to beta.agents.create. */
  tools?: AgentTool[];
  /** Anthropic-authored skills (docx, xlsx, etc.). */
  skills?: AgentSkill[];
  /**
   * Shorthand: when true, the SF_TOOL_DEFINITIONS (sf_query, sf_create,
   * sf_update, sf_upsert, sf_describe, sf_chatter) are appended to the
   * tools list before the agent is registered with Anthropic. These
   * custom tools are dispatched server-side by our session handler
   * against a jsforce-backed Connection.
   */
  includeSalesforceTools?: boolean;
  /**
   * Shorthand: when true, the FLOW_BUILDER_TOOL_DEFINITIONS
   * (save_workflow, list_existing_workflows) are appended to the tools
   * list. Use this for the meta flow-builder agent so it can create and
   * publish new workflows into our DB.
   */
  includeFlowBuilderTools?: boolean;
}

/** Deterministic conditional node. Evaluates `expression` against the run
 * context and picks one of two outgoing edges. Outgoing edges must have
 * `condition: "true"` and `condition: "false"` respectively (the UI
 * enforces this when wiring). */
export interface GateNodeConfig {
  /**
   * JS-like expression evaluated against the context. Allowed references:
   *   - `input.<field>` — the run's input
   *   - `steps.<nodeId>.outputs.<field>` — any prior step's output
   * Example: `steps.reader.outputs.parsed.score > 0.8`
   */
  expression: string;
}

/** LLM-classified routing node. Runs a one-shot Claude call over the
 * configured input and picks a label from `labels`. Outgoing edges must
 * carry `condition: "<label>"` to receive the route. */
export interface RouterNodeConfig {
  /** System prompt that instructs Claude how to classify. */
  instructions: string;
  /** Allowed output labels. The one Claude emits picks the route. */
  labels: string[];
  /** Same `$.run.input.*` / `$.steps.*` mapping shape as agent nodes. */
  inputMapping?: Record<string, string>;
  /** Optional model override; defaults to a cheap, fast one. */
  model?: string;
}

/** Configuration specific to human gate nodes */
export interface HumanGateNodeConfig {
  channel: string;
  messageTemplate: string;
  decisionValues: string[];
  /**
   * How long to wait for a decision before failing the step. Default 600s.
   */
  timeoutSeconds?: number;
  /**
   * Optional approver identity (Slack user id, display name, or Office
   * Space character name — used for fixture polish, not enforcement).
   */
  approver?: string;
  /**
   * Optional icon slug for UI flair (e.g. "red-stapler", "flair-buttons").
   */
  icon?: string;
}

/** Configuration specific to finalize nodes */
export interface FinalizeNodeConfig {
  summaryFields?: string[];
  /** If set, post a rich Block Kit summary of the whole run here. */
  slackChannel?: string;
  /** Headline to include in the Slack summary (supports {{...}}). */
  slackTitle?: string;
}

/** Configuration specific to subflow nodes (v2).
 *
 * Invokes another workflow as a step. The child run is recorded with
 * `parentRunId` so Run History can drill through the hierarchy.
 */
export interface SubflowNodeConfig {
  /** ID of the workflow to invoke. */
  workflowId: string;
  /** Map parent-run context → child-run input. Same syntax as agent nodes. */
  inputMapping?: Record<string, string>;
  /** When false, fire-and-forget; outputs = { childRunId }. Default true. */
  waitForCompletion?: boolean;
  /** When true (default), a failed child fails this step. False = treat as completed with outputs.failed=true. */
  propagateFailure?: boolean;
}

/** Configuration specific to map nodes (v2) — fan-out over a list.
 *
 * Instantiates N copies of `bodyNodeId` in parallel, each seeing one
 * element of the resolved list as `$.item`. Aggregates outputs into
 * `outputs.results: Array<StepResult>`.
 */
export interface MapNodeConfig {
  /** `$`-path to the source array. e.g. `$.steps.reader.outputs.items` */
  over: string;
  /** Name under which each element is exposed in the child context. */
  itemVar: string;
  /** Node id to execute per item. That node must exist in this workflow. */
  bodyNodeId: string;
  /** Max concurrent iterations. Default 10. */
  concurrency?: number;
  /** When true, abort on first failure. When false, collect all outcomes. Default false. */
  failFast?: boolean;
}

/** Union of all node configs based on type */
export type NodeConfig =
  | InputNodeConfig
  | AgentNodeConfig
  | GateNodeConfig
  | RouterNodeConfig
  | HumanGateNodeConfig
  | FinalizeNodeConfig
  | SubflowNodeConfig
  | MapNodeConfig;

/** A node in the workflow graph */
export interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  config: NodeConfig;
  modelConfig?: ModelConfig;
  /** v2: retry policy. Applies to the handler call for this node. */
  retry?: RetryPolicy;
}

// ── Edge types ──────────────────────────────────────────────────────

/** An edge connecting two nodes in the workflow graph.
 *
 * `condition` is REQUIRED when `source` is a gate / router / human_gate
 * node — it must match one of the source's declared outputs:
 *   - gate:       "true" | "false"
 *   - router:     one of config.labels
 *   - human_gate: one of config.decisionValues
 */
export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  condition?: string;
}

// ── Retry policy (v2) ───────────────────────────────────────────────

/** Per-node retry policy. Applies to agent / router / gate failures. */
export interface RetryPolicy {
  /** Max attempts (including the first). Default 1 (= no retry). */
  maxAttempts?: number;
  /** First wait before retry, in ms. Default 1000. */
  initialDelayMs?: number;
  /** Multiplier applied to delay each retry. Default 2. */
  backoffMultiplier?: number;
  /** Only retry on these failure kinds. Default: all. */
  retryOn?: ("timeout" | "tool_error" | "rate_limit" | "http_5xx")[];
}

/** Extension point — every NodeConfig may carry a retry policy. */
export interface WithRetry {
  retry?: RetryPolicy;
}

// ── Completion / notify (v2) ────────────────────────────────────────

/** Where to send the run-done notification when async completion is used. */
export interface NotifyTargets {
  slackChannel?: string;
  slackUserId?: string;
  webhookUrl?: string;
  email?: string;
}

/** Workflow-level completion mode + default notify targets. */
export interface CompletionConfig {
  /** "sync" = caller blocks; "async" = returns runId immediately. Default "sync". */
  mode?: "sync" | "async";
  /** Default notify targets; per-run input may override. */
  notify?: NotifyTargets;
}

// ── Triggers (v2) ───────────────────────────────────────────────────

/** Cron + webhook triggers — evaluated by the scheduler daemon at startup
 * and on every workflow save. */
export interface TriggerConfig {
  /** Standard cron expression (5 fields). e.g. "0 9 * * MON". */
  cron?: string;
  /** Webhook trigger — auto-registers a POST endpoint at /triggers/<path>. */
  webhook?: {
    path: string;
    /** HMAC secret. If set, requests must include X-Trigger-Signature header. */
    secret?: string;
  };
}

// ── Budget (v2) ─────────────────────────────────────────────────────

/** Per-workflow resource caps. Executor aborts the run on overage. */
export interface BudgetConfig {
  maxTokens?: number;
  maxCostUsd?: number;
  maxDurationSeconds?: number;
}

// ── Workflow Schema ─────────────────────────────────────────────────

/** Top-level schema defining a complete workflow */
export interface WorkflowSchema {
  id: string;
  name: string;
  /** "1.0" for v1, "2.0" for workflows that use v2-only fields. */
  version: string;
  entryNodeId: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  /** v2: run-completion / notify policy. */
  completion?: CompletionConfig;
  /** v2: cron / webhook triggers. */
  triggers?: TriggerConfig;
  /** v2: token / cost / duration caps. */
  budget?: BudgetConfig;
}

// ── Runtime Context ─────────────────────────────────────────────────

/** Outputs produced by a single step */
export interface StepResult {
  outputs: Record<string, unknown>;
}

/** Runtime context threaded through the executor */
export interface RunContext {
  workflowId: string;
  run: {
    id: string;
    input: Record<string, unknown>;
  };
  steps: Record<string, StepResult>;
  /** v2: the workflow schema this run executes. Set by the executor so
   *  handlers (e.g. map) can look up sibling nodes without a round-trip. */
  schema?: WorkflowSchema;
  /** v2 map: per-iteration item context. Set by the map handler for
   *  nested handlers to read via resolveInputMapping. */
  item?: Record<string, unknown>;
}

// ── Handler signature ───────────────────────────────────────────────

/** Options passed to every node handler */
export interface HandlerOptions {
  runId: string;
  stepId: string;
}

/** Uniform handler function signature */
export type NodeHandler = (
  node: WorkflowNode,
  ctx: RunContext,
  opts: HandlerOptions
) => Promise<StepResult>;

// ── Persistence types ───────────────────────────────────────────────

export type RunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";
export type StepStatus =
  | "running"
  | "completed"
  | "failed"
  | "awaiting_approval"
  | "cancelled";

export type EventType =
  | "workflow_started"
  | "workflow_completed"
  | "step_started"
  | "step_retry"
  | "run_cancelled"
  | "budget_exceeded"
  | "notify_sent"
  | "step_completed"
  | "step_failed"
  | "error"
  | "max_steps_exceeded"
  | "server_restart";
