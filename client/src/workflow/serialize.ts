/**
 * Workflow serialization / deserialization.
 *
 * Converts between React Flow state (nodes + edges) and
 * the WorkflowSchema shape the server API expects.
 *
 * Invariants:
 *   - schemaVersion (stored as `version`) is always "1.0"
 *   - entryNodeId is always the single InputNode id
 *   - Edge `condition` is omitted in Phase 1
 *   - __editorPosition is persisted in node config for layout round-trips
 */
import type { Node, Edge } from "@xyflow/react";
import type {
  WorkflowSchema,
  WorkflowNode,
  WorkflowEdge,
  WorkflowNodeData,
  NodeType,
} from "./types";
import crypto from "./cryptoShim";

/**
 * Serialize React Flow state into a WorkflowSchema.
 */
export function serializeWorkflow(
  nodes: Node[],
  edges: Edge[],
  meta: { id?: string; name: string }
): WorkflowSchema {
  // entryNodeId MUST be the single InputNode; throw if 0 or >1
  const inputNodes = nodes.filter((n) => n.type === "input");
  if (inputNodes.length === 0) {
    throw new Error("Workflow must have an Input node to set as the entry point.");
  }
  if (inputNodes.length > 1) {
    throw new Error("Workflow must have exactly one Input node (found " + inputNodes.length + ").");
  }
  const entryNodeId = inputNodes[0].id;

  const schemaNodes: WorkflowNode[] = nodes.map((n) => {
    const data = n.data as unknown as WorkflowNodeData;
    const config = { ...data.config };
    // Persist editor position in config so layout survives round-trips
    (config as Record<string, unknown>).__editorPosition = {
      x: n.position.x,
      y: n.position.y,
    };

    return {
      id: n.id,
      type: (data.nodeType ?? n.type) as NodeType,
      name: data.name || n.type || "Unnamed",
      config,
      ...(data.modelConfig ? { modelConfig: data.modelConfig } : {}),
    };
  });

  const schemaEdges: WorkflowEdge[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    // React Flow puts the handle id (e.g. "true"/"false" for a gate, or a
    // router label) on the edge as `sourceHandle`. Persist as `condition`
    // so the executor can route on it.
    ...((e as Edge & { sourceHandle?: string | null }).sourceHandle
      ? { condition: (e as Edge & { sourceHandle?: string }).sourceHandle }
      : {}),
  }));

  return {
    id: meta.id || `wf-${crypto.randomId()}`,
    name: meta.name,
    version: "1.0",
    entryNodeId,
    nodes: schemaNodes,
    edges: schemaEdges,
  };
}

/**
 * Compute a simple left-to-right BFS layout from the entry node.
 * Returns a map of nodeId -> { x, y }.
 */
function computeLeftToRightLayout(
  entryNodeId: string,
  nodes: Array<{ id: string }>,
  edges: Array<{ source: string; target: string }>
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const adjacency = new Map<string, string[]>();

  // Build adjacency list (source -> targets)
  for (const e of edges) {
    if (!adjacency.has(e.source)) adjacency.set(e.source, []);
    adjacency.get(e.source)!.push(e.target);
  }

  // BFS from entry node
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [];
  const depthBuckets = new Map<number, string[]>();

  if (entryNodeId) {
    queue.push({ id: entryNodeId, depth: 0 });
    visited.add(entryNodeId);
  }

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (!depthBuckets.has(depth)) depthBuckets.set(depth, []);
    depthBuckets.get(depth)!.push(id);

    const children = adjacency.get(id) ?? [];
    for (const child of children) {
      if (!visited.has(child)) {
        visited.add(child);
        queue.push({ id: child, depth: depth + 1 });
      }
    }
  }

  // Place any nodes not reachable from entry (orphans) in a final column
  const maxDepth = depthBuckets.size;
  const orphans: string[] = [];
  for (const n of nodes) {
    if (!visited.has(n.id)) {
      orphans.push(n.id);
    }
  }
  if (orphans.length > 0) {
    depthBuckets.set(maxDepth, orphans);
  }

  const X_GAP = 260;
  const Y_GAP = 120;

  for (const [depth, ids] of depthBuckets) {
    for (let i = 0; i < ids.length; i++) {
      positions.set(ids[i], { x: depth * X_GAP + 50, y: i * Y_GAP + 50 });
    }
  }

  return positions;
}

/**
 * Deserialize a WorkflowSchema into React Flow nodes + edges.
 * Prefers stored __editorPosition; falls back to BFS left-to-right layout.
 */
export function deserializeWorkflow(schema: WorkflowSchema): {
  nodes: Node[];
  edges: Edge[];
} {
  // Check if any node has __editorPosition
  const hasStoredPositions = schema.nodes.some(
    (wn) => (wn.config as Record<string, unknown>).__editorPosition != null
  );

  // Compute BFS layout as fallback
  const bfsPositions = !hasStoredPositions
    ? computeLeftToRightLayout(
        schema.entryNodeId,
        schema.nodes,
        schema.edges.map((e) => ({ source: e.source, target: e.target }))
      )
    : null;

  const nodes = schema.nodes.map((wn, index) => {
    const storedPos = (wn.config as Record<string, unknown>).__editorPosition as
      | { x: number; y: number }
      | undefined;

    // Strip __editorPosition from config before storing in data
    const config = { ...wn.config };
    delete (config as Record<string, unknown>).__editorPosition;

    // Priority: stored position > BFS layout > simple fallback
    const position =
      storedPos ??
      bfsPositions?.get(wn.id) ??
      { x: 250, y: index * 150 + 50 };

    return {
      id: wn.id,
      type: wn.type,
      position,
      data: {
        name: wn.name,
        nodeType: wn.type,
        config,
        ...(wn.modelConfig ? { modelConfig: wn.modelConfig } : {}),
      } as WorkflowNodeData,
    };
  });

  const edges: Edge[] = schema.edges.map((we) => ({
    id: we.id,
    source: we.source,
    target: we.target,
    type: "deletable",
    // Round-trip the condition back to sourceHandle so gate/router nodes
    // connect to the right handle (true/false or label).
    ...(we.condition ? { sourceHandle: we.condition, label: we.condition } : {}),
  }));

  return { nodes: nodes as unknown as Node[], edges };
}
