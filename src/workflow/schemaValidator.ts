/**
 * Strict workflow schema validator (Sprint 6).
 *
 * Validates the full structure of a workflow definition object.
 * Collects ALL errors rather than short-circuiting on the first.
 *
 * Rules:
 *   - schemaVersion must equal '1.0'
 *   - flowId and name must be non-empty strings
 *   - entryNodeId must reference a node in nodes[]
 *   - nodes[] must be non-empty; each node needs id, type, name
 *   - agent nodes must have config.instructions (non-empty string)
 *   - edges[] each need from/to referencing valid node IDs
 *   - Exactly one finalize node must exist
 *
 * Also accepts legacy field names for backward compatibility:
 *   - id → flowId
 *   - version → schemaVersion
 *   - source/target → from/to (edges)
 */

export interface SchemaValidationResult {
  valid: boolean;
  /** @deprecated use `valid` — kept for backward compat with callers using `ok` */
  ok: boolean;
  errors: string[];
}

const VALID_NODE_TYPES = new Set(["input", "agent", "human_gate", "finalize"]);

export function validateWorkflowSchema(schema: unknown): SchemaValidationResult {
  const errors: string[] = [];

  if (!schema || typeof schema !== "object") {
    return { valid: false, ok: false, errors: ["Schema must be a non-null object"] };
  }

  const s = schema as Record<string, unknown>;

  // ── Top-level fields ──────────────────────────────────────────────

  // schemaVersion (accept legacy 'version')
  const schemaVersion = s.schemaVersion ?? s.version;
  if (schemaVersion !== "1.0") {
    errors.push(
      `'schemaVersion' must equal '1.0' (got ${schemaVersion === undefined ? "undefined" : JSON.stringify(schemaVersion)})`
    );
  }

  // flowId (accept legacy 'id')
  const flowId = s.flowId ?? s.id;
  if (typeof flowId !== "string" || !flowId.trim()) {
    errors.push("'flowId' (or 'id') must be a non-empty string");
  }

  // name
  if (typeof s.name !== "string" || !s.name.trim()) {
    errors.push("'name' must be a non-empty string");
  }

  // entryNodeId
  if (typeof s.entryNodeId !== "string" || !s.entryNodeId.trim()) {
    errors.push("'entryNodeId' must be a non-empty string");
  }

  // nodes
  if (!Array.isArray(s.nodes) || s.nodes.length === 0) {
    errors.push("'nodes' must be a non-empty array");
    return result(errors);
  }

  // edges
  if (!Array.isArray(s.edges)) {
    errors.push("'edges' must be an array");
    return result(errors);
  }

  const nodes = s.nodes as Array<Record<string, unknown>>;
  const edges = s.edges as Array<Record<string, unknown>>;
  const nodeIds = new Set<string>();

  // ── Validate each node ────────────────────────────────────────────

  let finalizeCount = 0;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const prefix = `nodes[${i}]`;

    // id
    if (typeof node.id !== "string" || !node.id.trim()) {
      errors.push(`${prefix}: missing or empty 'id'`);
    } else {
      nodeIds.add(node.id);
    }

    // type
    if (typeof node.type !== "string" || !VALID_NODE_TYPES.has(node.type)) {
      errors.push(
        `${prefix} (id="${node.id ?? "?"}"): 'type' must be one of ${[...VALID_NODE_TYPES].join(", ")} (got '${node.type}')`
      );
    }

    // name
    if (typeof node.name !== "string" || !node.name.trim()) {
      errors.push(`${prefix} (id="${node.id ?? "?"}"): missing or empty 'name'`);
    }

    // agent nodes: config.instructions required
    if (node.type === "agent") {
      const config = node.config as Record<string, unknown> | undefined;
      if (
        !config ||
        typeof config !== "object" ||
        typeof config.instructions !== "string" ||
        !config.instructions.trim()
      ) {
        errors.push(
          `${prefix} (id="${node.id ?? "?"}"): agent nodes must have config.instructions (non-empty string)`
        );
      }
    }

    // Count finalize nodes
    if (node.type === "finalize") {
      finalizeCount++;
    }
  }

  // Exactly one finalize node
  if (finalizeCount === 0) {
    errors.push("Workflow must have exactly one 'finalize' node (found 0)");
  } else if (finalizeCount > 1) {
    errors.push(
      `Workflow must have exactly one 'finalize' node (found ${finalizeCount})`
    );
  }

  // entryNodeId must reference a node
  const entryNodeId = s.entryNodeId as string;
  if (entryNodeId && nodeIds.size > 0 && !nodeIds.has(entryNodeId)) {
    errors.push(`'entryNodeId' ("${entryNodeId}") does not match any node id`);
  }

  // ── Validate each edge ────────────────────────────────────────────

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const prefix = `edges[${i}]`;

    // Accept from/to (spec) OR source/target (legacy React Flow)
    const from = (edge.from ?? edge.source) as string | undefined;
    const to = (edge.to ?? edge.target) as string | undefined;

    if (typeof from !== "string" || !from.trim()) {
      errors.push(`${prefix}: missing 'from' (or 'source')`);
    } else if (!nodeIds.has(from)) {
      errors.push(`${prefix}: 'from' ("${from}") does not reference a valid node id`);
    }

    if (typeof to !== "string" || !to.trim()) {
      errors.push(`${prefix}: missing 'to' (or 'target')`);
    } else if (!nodeIds.has(to)) {
      errors.push(`${prefix}: 'to' ("${to}") does not reference a valid node id`);
    }
  }

  return result(errors);
}

function result(errors: string[]): SchemaValidationResult {
  const valid = errors.length === 0;
  return { valid, ok: valid, errors };
}
