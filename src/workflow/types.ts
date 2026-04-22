/**
 * Workflow Schema & Runtime types for the orchestrator engine.
 *
 * A WorkflowSchema is a directed graph of nodes connected by edges.
 * The executor walks the graph, executing each node in sequence.
 */

// ── Node types ──────────────────────────────────────────────────────

/** Supported node types in a workflow graph */
export type NodeType = "input" | "agent" | "human_gate" | "finalize";

/** Model configuration for agent nodes */
export interface ModelConfig {
  model?: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

/** Configuration specific to input nodes */
export interface InputNodeConfig {
  requiredFields?: string[];
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
}

/** Configuration specific to human gate nodes */
export interface HumanGateNodeConfig {
  channel: string;
  messageTemplate: string;
  decisionValues: string[];
}

/** Configuration specific to finalize nodes */
export interface FinalizeNodeConfig {
  summaryFields?: string[];
}

/** Union of all node configs based on type */
export type NodeConfig = InputNodeConfig | AgentNodeConfig | HumanGateNodeConfig | FinalizeNodeConfig;

/** A node in the workflow graph */
export interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  config: NodeConfig;
  modelConfig?: ModelConfig;
}

// ── Edge types ──────────────────────────────────────────────────────

/** An edge connecting two nodes in the workflow graph */
export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  /** Reserved for future conditional routing. Not used in v1. */
  condition?: string;
}

// ── Workflow Schema ─────────────────────────────────────────────────

/** Top-level schema defining a complete workflow */
export interface WorkflowSchema {
  id: string;
  name: string;
  version: string;
  entryNodeId: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
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

export type RunStatus = "pending" | "running" | "completed" | "failed";
export type StepStatus = "running" | "completed" | "failed";

export type EventType =
  | "workflow_started"
  | "workflow_completed"
  | "step_started"
  | "step_completed"
  | "step_failed"
  | "error"
  | "max_steps_exceeded"
  | "server_restart";
