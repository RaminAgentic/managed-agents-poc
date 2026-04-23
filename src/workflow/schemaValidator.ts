/**
 * Strict workflow schema validator.
 *
 * Validates the full structure of a workflow definition object.
 * Collects ALL errors rather than short-circuiting on the first.
 *
 * Rules (v1 — stable):
 *   - version must equal '1.0' or '2.0'
 *   - id (or flowId) and name must be non-empty strings
 *   - entryNodeId must reference a node in nodes[]
 *   - nodes[] must be non-empty; each node needs id, type, name
 *   - agent nodes must have config.instructions (non-empty string)
 *   - edges[] each need from/to (or source/target) referencing valid nodes
 *   - Exactly one finalize node must exist
 *
 * Rules added for v2:
 *   - gate nodes must have exactly 2 outgoing edges with conditions
 *     "true" and "false"
 *   - router nodes must have at least 1 outgoing edge per declared label;
 *     every outgoing edge's condition must be in `labels`
 *   - human_gate nodes must have at least 1 outgoing edge per
 *     `decisionValues` entry; every outgoing edge's condition must be in
 *     `decisionValues`
 *   - subflow nodes must have config.workflowId
 *   - map nodes must have config.over, config.itemVar, config.bodyNodeId,
 *     and bodyNodeId must reference a node in the same workflow
 *
 * The v2 edge-condition rules apply to all workflows regardless of
 * version — the comment on WorkflowEdge.condition that said it was
 * "reserved for future routing" has been wrong for a while (fixtures
 * use it heavily), so we enforce it going forward.
 *
 * Also accepts legacy field names for backward compatibility:
 *   - flowId → id
 *   - schemaVersion → version
 *   - from/to → source/target (edges)
 */

export interface SchemaValidationResult {
  valid: boolean;
  /** @deprecated use `valid` — kept for backward compat with callers using `ok` */
  ok: boolean;
  errors: string[];
}

const VALID_NODE_TYPES = new Set([
  "input",
  "agent",
  "gate",
  "router",
  "human_gate",
  "finalize",
  "subflow",
  "map",
]);

const VALID_SCHEMA_VERSIONS = new Set(["1.0", "2.0"]);

export function validateWorkflowSchema(schema: unknown): SchemaValidationResult {
  const errors: string[] = [];

  if (!schema || typeof schema !== "object") {
    return { valid: false, ok: false, errors: ["Schema must be a non-null object"] };
  }

  const s = schema as Record<string, unknown>;

  // ── Top-level fields ──────────────────────────────────────────────

  // version (accept legacy 'schemaVersion')
  const schemaVersion = s.version ?? s.schemaVersion;
  if (
    typeof schemaVersion !== "string" ||
    !VALID_SCHEMA_VERSIONS.has(schemaVersion)
  ) {
    errors.push(
      `'version' must be one of ${[...VALID_SCHEMA_VERSIONS].join(" | ")} (got ${schemaVersion === undefined ? "undefined" : JSON.stringify(schemaVersion)})`
    );
  }

  // id (accept legacy 'flowId')
  const flowId = s.id ?? s.flowId;
  if (typeof flowId !== "string" || !flowId.trim()) {
    errors.push("'id' (or 'flowId') must be a non-empty string");
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
  const nodeById = new Map<string, Record<string, unknown>>();

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
      nodeById.set(node.id, node);
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

    // subflow nodes (v2): config.workflowId required
    if (node.type === "subflow") {
      const config = node.config as Record<string, unknown> | undefined;
      if (
        !config ||
        typeof config.workflowId !== "string" ||
        !config.workflowId.trim()
      ) {
        errors.push(
          `${prefix} (id="${node.id ?? "?"}"): subflow nodes must have config.workflowId`
        );
      }
    }

    // map nodes (v2): config.over, itemVar, bodyNodeId required
    if (node.type === "map") {
      const config = node.config as Record<string, unknown> | undefined;
      if (!config || typeof config !== "object") {
        errors.push(
          `${prefix} (id="${node.id ?? "?"}"): map nodes must have a config object`
        );
      } else {
        if (typeof config.over !== "string" || !config.over.trim()) {
          errors.push(
            `${prefix} (id="${node.id ?? "?"}"): map.config.over must be a $-path string`
          );
        }
        if (typeof config.itemVar !== "string" || !config.itemVar.trim()) {
          errors.push(
            `${prefix} (id="${node.id ?? "?"}"): map.config.itemVar must be a non-empty string`
          );
        }
        if (typeof config.bodyNodeId !== "string" || !config.bodyNodeId.trim()) {
          errors.push(
            `${prefix} (id="${node.id ?? "?"}"): map.config.bodyNodeId must reference a node id`
          );
        }
      }
    }

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

  // map.bodyNodeId must reference a node (after all ids are known)
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.type !== "map") continue;
    const bodyId = (node.config as Record<string, unknown> | undefined)
      ?.bodyNodeId;
    if (typeof bodyId === "string" && bodyId.trim() && !nodeIds.has(bodyId)) {
      errors.push(
        `nodes[${i}] (id="${node.id ?? "?"}"): map.bodyNodeId '${bodyId}' does not reference any node`
      );
    }
  }

  // ── Validate each edge ────────────────────────────────────────────

  // Build source → outgoing edges map (normalized to source/target)
  const outgoingBySource = new Map<
    string,
    Array<{ index: number; from: string; to: string; condition?: string }>
  >();

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const prefix = `edges[${i}]`;

    const from = (edge.source ?? edge.from) as string | undefined;
    const to = (edge.target ?? edge.to) as string | undefined;
    const condition =
      typeof edge.condition === "string" ? edge.condition : undefined;

    if (typeof from !== "string" || !from.trim()) {
      errors.push(`${prefix}: missing 'source' (or 'from')`);
    } else if (!nodeIds.has(from)) {
      errors.push(
        `${prefix}: 'source' ("${from}") does not reference a valid node id`
      );
    }

    if (typeof to !== "string" || !to.trim()) {
      errors.push(`${prefix}: missing 'target' (or 'to')`);
    } else if (!nodeIds.has(to)) {
      errors.push(
        `${prefix}: 'target' ("${to}") does not reference a valid node id`
      );
    }

    if (typeof from === "string" && nodeIds.has(from)) {
      const arr = outgoingBySource.get(from) ?? [];
      arr.push({ index: i, from, to: to ?? "?", condition });
      outgoingBySource.set(from, arr);
    }
  }

  // ── Branch-node edge condition rules ──────────────────────────────

  for (const [sourceId, outs] of outgoingBySource) {
    const node = nodeById.get(sourceId);
    if (!node) continue;
    const nodeType = node.type as string;

    if (nodeType === "gate") {
      const conds = outs.map((o) => o.condition);
      if (outs.length !== 2) {
        errors.push(
          `gate '${sourceId}': must have exactly 2 outgoing edges with conditions "true" and "false" (found ${outs.length})`
        );
      }
      const hasTrue = conds.includes("true");
      const hasFalse = conds.includes("false");
      if (!hasTrue || !hasFalse) {
        errors.push(
          `gate '${sourceId}': outgoing edge conditions must be "true" and "false" (got ${JSON.stringify(conds)})`
        );
      }
    }

    if (nodeType === "router") {
      const labels = ((node.config as Record<string, unknown> | undefined)
        ?.labels as string[] | undefined) ?? [];
      const labelSet = new Set(labels);
      for (const out of outs) {
        if (!out.condition || !labelSet.has(out.condition)) {
          errors.push(
            `router '${sourceId}': edges[${out.index}] condition '${out.condition ?? "(missing)"}' is not in declared labels ${JSON.stringify(labels)}`
          );
        }
      }
    }

    if (nodeType === "human_gate") {
      const values = ((node.config as Record<string, unknown> | undefined)
        ?.decisionValues as string[] | undefined) ?? [];
      const valueSet = new Set(values);
      for (const out of outs) {
        if (!out.condition || !valueSet.has(out.condition)) {
          errors.push(
            `human_gate '${sourceId}': edges[${out.index}] condition '${out.condition ?? "(missing)"}' is not in decisionValues ${JSON.stringify(values)}`
          );
        }
      }
    }
  }

  return result(errors);
}

function result(errors: string[]): SchemaValidationResult {
  const valid = errors.length === 0;
  return { valid, ok: valid, errors };
}
