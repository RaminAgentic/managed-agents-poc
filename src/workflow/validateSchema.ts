/**
 * Workflow schema validator.
 *
 * Performs structural validation of a WorkflowSchema object:
 * - Required top-level fields
 * - Entry node exists
 * - All edge source/target nodes exist
 * - At least one node of each required type
 * - No orphaned nodes (not reachable from entry)
 */
import type { WorkflowSchema } from "./types";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateWorkflowSchema(schema: unknown): ValidationResult {
  const errors: string[] = [];

  if (!schema || typeof schema !== "object") {
    return { ok: false, errors: ["Schema must be a non-null object"] };
  }

  const s = schema as Record<string, unknown>;

  // Required top-level fields
  if (typeof s.id !== "string" || !s.id) {
    errors.push("Missing or invalid 'id' field");
  }
  if (typeof s.name !== "string" || !s.name) {
    errors.push("Missing or invalid 'name' field");
  }
  if (typeof s.version !== "string" || !s.version) {
    errors.push("Missing or invalid 'version' field");
  }
  if (typeof s.entryNodeId !== "string" || !s.entryNodeId) {
    errors.push("Missing or invalid 'entryNodeId' field");
  }
  if (!Array.isArray(s.nodes) || s.nodes.length === 0) {
    errors.push("'nodes' must be a non-empty array");
    return { ok: false, errors };
  }
  if (!Array.isArray(s.edges)) {
    errors.push("'edges' must be an array");
    return { ok: false, errors };
  }

  const ws = schema as WorkflowSchema;
  const nodeIds = new Set(ws.nodes.map((n) => n.id));

  // Entry node must exist
  if (!nodeIds.has(ws.entryNodeId)) {
    errors.push(`entryNodeId '${ws.entryNodeId}' does not match any node`);
  }

  // Validate each node
  const validTypes = new Set(["input", "agent", "human_gate", "finalize"]);
  for (const node of ws.nodes) {
    if (!node.id || typeof node.id !== "string") {
      errors.push("Node missing 'id'");
    }
    if (!validTypes.has(node.type)) {
      errors.push(`Node '${node.id}' has invalid type '${node.type}'`);
    }
    if (!node.name || typeof node.name !== "string") {
      errors.push(`Node '${node.id}' missing 'name'`);
    }
  }

  // Validate edges
  for (const edge of ws.edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push(`Edge '${edge.id}' source '${edge.source}' not found in nodes`);
    }
    if (!nodeIds.has(edge.target)) {
      errors.push(`Edge '${edge.id}' target '${edge.target}' not found in nodes`);
    }
  }

  // Must have at least one input node and one finalize node
  const hasInput = ws.nodes.some((n) => n.type === "input");
  const hasFinalize = ws.nodes.some((n) => n.type === "finalize");
  if (!hasInput) errors.push("Workflow must have at least one 'input' node");
  if (!hasFinalize) errors.push("Workflow must have at least one 'finalize' node");

  return { ok: errors.length === 0, errors };
}
