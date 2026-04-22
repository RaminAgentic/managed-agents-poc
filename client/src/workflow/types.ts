/**
 * Client-side workflow types — mirrors server src/workflow/types.ts
 * Kept as a local copy to avoid cross-boundary imports through Vite.
 */

// ── Node types ──────────────────────────────────────────────────────

export type NodeType = "input" | "agent" | "human_gate" | "finalize";

export interface ModelConfig {
  model?: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

export interface InputNodeConfig {
  requiredFields?: string[];
  __editorPosition?: { x: number; y: number };
}

export interface AgentNodeConfig {
  instructions: string;
  inputMapping?: Record<string, string>;
  timeoutSeconds?: number;
  outputFormat?: "text" | "json";
  __editorPosition?: { x: number; y: number };
}

export interface HumanGateNodeConfig {
  channel: string;
  messageTemplate: string;
  decisionValues: string[];
  __editorPosition?: { x: number; y: number };
}

export interface FinalizeNodeConfig {
  summaryFields?: string[];
  __editorPosition?: { x: number; y: number };
}

export type NodeConfig = InputNodeConfig | AgentNodeConfig | HumanGateNodeConfig | FinalizeNodeConfig;

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
