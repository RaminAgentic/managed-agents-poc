/**
 * Render a workflow schema + run steps as a Mermaid flowchart.
 *
 * The diagram shows every node in the schema, colored by its current
 * execution state (pending / running / completed / failed / pruned /
 * awaiting-approval). Edges carry their `condition` label when present.
 *
 * Used by:
 *   - get_run_status MCP tool response (Cowork renders inline)
 *   - Run Detail UI (client-side mermaid.js renders it)
 *   - Slack summary post (included as a code block — mermaid.live link
 *     in the message text for people who want to view it)
 */
import type { WorkflowSchema } from "./types";
import type { RunStepRow } from "./persistence";

type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "awaiting_approval"
  | "pruned";

const STYLE = {
  pending:           "fill:#f3f4f6,stroke:#9ca3af,color:#6b7280",
  running:           "fill:#dbeafe,stroke:#3b82f6,color:#1e40af,stroke-width:3px",
  completed:         "fill:#d1fae5,stroke:#10b981,color:#065f46",
  failed:            "fill:#fee2e2,stroke:#dc2626,color:#991b1b,stroke-width:3px",
  awaiting_approval: "fill:#fef3c7,stroke:#f59e0b,color:#92400e,stroke-width:3px",
  pruned:            "fill:#e5e7eb,stroke:#d1d5db,color:#9ca3af,stroke-dasharray:4 4",
};

const SHAPE: Record<string, (id: string, label: string) => string> = {
  input:      (id, l) => `${id}([${l}])`,
  agent:      (id, l) => `${id}[${l}]`,
  gate:       (id, l) => `${id}{${l}}`,
  router:     (id, l) => `${id}[/${l}/]`,
  human_gate: (id, l) => `${id}[["${l}"]]`,
  finalize:   (id, l) => `${id}(((${l})))`,
};

function safeLabel(s: string): string {
  return s
    .replace(/"/g, "'")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 60);
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

function stepStatusFor(
  nodeId: string,
  stepsByNodeId: Map<string, RunStepRow>
): StepStatus {
  const step = stepsByNodeId.get(nodeId);
  if (!step) return "pending";
  switch (step.status) {
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "awaiting_approval":
      return "awaiting_approval";
    default:
      return "pending";
  }
}

export function renderWorkflowMermaid(
  schema: WorkflowSchema,
  steps: RunStepRow[]
): string {
  const stepsByNodeId = new Map<string, RunStepRow>();
  for (const s of steps) {
    // Keep the most recent step per node (handles re-entrant nodes)
    const prior = stepsByNodeId.get(s.node_id);
    if (!prior || new Date(s.started_at) > new Date(prior.started_at)) {
      stepsByNodeId.set(s.node_id, s);
    }
  }

  const lines: string[] = [];
  lines.push("flowchart TD");

  // Nodes — pick shape by type, attach a status class
  const classByNode = new Map<string, StepStatus>();
  for (const node of schema.nodes) {
    const nodeId = safeId(node.id);
    const status = stepStatusFor(node.id, stepsByNodeId);
    classByNode.set(nodeId, status);

    const shape = SHAPE[node.type] ?? SHAPE.agent;
    const label = safeLabel(node.name || node.id);
    lines.push(`  ${shape(nodeId, label)}`);
  }

  // Edges
  for (const edge of schema.edges) {
    const s = safeId(edge.source);
    const t = safeId(edge.target);
    const cond = edge.condition ? `|${safeLabel(edge.condition)}|` : "";
    lines.push(`  ${s} -->${cond} ${t}`);
  }

  // Status classes
  const byStatus: Record<StepStatus, string[]> = {
    pending: [],
    running: [],
    completed: [],
    failed: [],
    awaiting_approval: [],
    pruned: [],
  };
  for (const [nodeId, status] of classByNode) {
    byStatus[status].push(nodeId);
  }
  for (const [status, nodeIds] of Object.entries(byStatus)) {
    if (nodeIds.length === 0) continue;
    const cls = status.replace(/_/g, "");
    lines.push(`  classDef ${cls} ${STYLE[status as StepStatus]}`);
    lines.push(`  class ${nodeIds.join(",")} ${cls}`);
  }

  return lines.join("\n");
}
