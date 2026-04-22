/**
 * Client-side workflow types — mirrors server src/workflow/types.ts
 * Kept as a local copy to avoid cross-boundary imports through Vite.
 */

// ── Node types ──────────────────────────────────────────────────────

export type NodeType =
  | "input"
  | "agent"
  | "gate"
  | "router"
  | "human_gate"
  | "finalize";

export interface ModelConfig {
  model?: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

export interface InputNodeConfig {
  requiredFields?: string[];
  __editorPosition?: { x: number; y: number };
}

export interface AgentMcpServer {
  name: string;
  type: "url";
  url: string;
}

export interface AgentTool {
  type: string;
  mcp_server_name?: string;
  default_config?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AgentSkill {
  type: "anthropic";
  skill_id: string;
}

export interface AgentNodeConfig {
  instructions: string;
  agentRef?: string;
  inputMapping?: Record<string, string>;
  timeoutSeconds?: number;
  outputFormat?: "text" | "json";
  mcpServers?: AgentMcpServer[];
  tools?: AgentTool[];
  skills?: AgentSkill[];
  __editorPosition?: { x: number; y: number };
}

export interface GateNodeConfig {
  expression: string;
  __editorPosition?: { x: number; y: number };
}

export interface RouterNodeConfig {
  instructions: string;
  labels: string[];
  inputMapping?: Record<string, string>;
  model?: string;
  __editorPosition?: { x: number; y: number };
}

export interface HumanGateNodeConfig {
  channel: string;
  messageTemplate: string;
  decisionValues: string[];
  timeoutSeconds?: number;
  approver?: string;
  icon?: string;
  __editorPosition?: { x: number; y: number };
}

export interface FinalizeNodeConfig {
  summaryFields?: string[];
  __editorPosition?: { x: number; y: number };
}

export type NodeConfig =
  | InputNodeConfig
  | AgentNodeConfig
  | GateNodeConfig
  | RouterNodeConfig
  | HumanGateNodeConfig
  | FinalizeNodeConfig;

export interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  config: NodeConfig;
  modelConfig?: ModelConfig;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  condition?: string;
}

export interface WorkflowSchema {
  id: string;
  name: string;
  version: string;
  entryNodeId: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

// ── React Flow node data shape ─────────────────────────────────────

export interface WorkflowNodeData {
  name: string;
  nodeType: NodeType;
  config: NodeConfig;
  modelConfig?: ModelConfig;
}
