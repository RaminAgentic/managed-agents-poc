/**
 * Client-side workflow validator.
 *
 * Intentionally permissive compared to the server — this is
 * a UX helper, not a security boundary.
 */
import type { Node, Edge } from "@xyflow/react";
import type { WorkflowNodeData, AgentNodeConfig, HumanGateNodeConfig } from "./types";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateWorkflow(nodes: Node[], edges: Edge[]): ValidationResult {
  const errors: string[] = [];

  if (nodes.length === 0) {
    errors.push("Workflow must have at least one node.");
    return { ok: false, errors };
  }

  const nodeIds = new Set(nodes.map((n) => n.id));

  // Must have at least one input node
  const inputNodes = nodes.filter((n) => n.type === "input");
  if (inputNodes.length === 0) {
    errors.push("Workflow must have at least one Input node.");
  }
  if (inputNodes.length > 1) {
    errors.push("Warning: Multiple Input nodes found. The first one will be used as the entry point.");
  }

  // Must have at least one finalize node
  const finalizeNodes = nodes.filter((n) => n.type === "finalize");
  if (finalizeNodes.length === 0) {
    errors.push("Workflow must have at least one Finalize node.");
  }

  // Every edge source/target must exist
  for (const edge of edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push(`Edge '${edge.id}' references non-existent source node '${edge.source}'.`);
    }
    if (!nodeIds.has(edge.target)) {
      errors.push(`Edge '${edge.id}' references non-existent target node '${edge.target}'.`);
    }
  }

  // Per-type validation
  for (const node of nodes) {
    const data = node.data as unknown as WorkflowNodeData;

    if (node.type === "agent") {
      const cfg = data.config as AgentNodeConfig;
      if (!cfg.instructions || cfg.instructions.trim() === "") {
        errors.push(`Agent node '${data.name || node.id}' must have non-empty instructions.`);
      }
    }

    if (node.type === "human_gate") {
      const cfg = data.config as HumanGateNodeConfig;
      if (!cfg.channel || cfg.channel.trim() === "") {
        errors.push(`Human Gate node '${data.name || node.id}' must have a channel.`);
      }
      if (!cfg.decisionValues || cfg.decisionValues.length === 0) {
        errors.push(`Human Gate node '${data.name || node.id}' must have at least one decision value.`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
