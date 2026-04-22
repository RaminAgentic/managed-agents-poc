export type AgentType = "weather" | "research" | "other";

export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  agentType?: AgentType;
  pending?: boolean;
}

export interface ChatResponse {
  response: string;
  agentType: AgentType;
}

// ── Run types (wire format — snake_case from server) ───────────────

export type RunStatus = "pending" | "running" | "completed" | "failed";
export type StepStatus = "running" | "completed" | "failed";

/** Shape returned by GET /api/runs (list view) */
export interface RunSummary {
  id: string;
  workflowId: string;
  workflowName: string;
  status: RunStatus;
  createdAt: string;
}

/** Shape returned by GET /api/runs/:id (detail view) */
export interface RunDetail {
  id: string;
  workflow_id: string;
  workflow_name: string;
  schema_json: string;
  status: RunStatus;
  input_json: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  steps: RunStep[];
  events: RunEvent[];
}

/** A single step execution within a run */
export interface RunStep {
  id: string;
  run_id: string;
  node_id: string;
  status: StepStatus;
  input_json: string | null;
  output_json: string | null;
  error_message: string | null;
  error_stack: string | null;
  agent_session_id: string | null;
  agent_id: string | null;
  agent_version: number | null;
  anthropic_agent_id: string | null;
  started_at: string;
  completed_at: string | null;
}

/** Audit trail event */
export interface RunEvent {
  id: string;
  run_id: string;
  step_id: string | null;
  event_type: string;
  payload: string;
  created_at: string;
}

/** Node from the workflow schema (for joining step → node metadata) */
export interface WorkflowSchemaNode {
  id: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
}
