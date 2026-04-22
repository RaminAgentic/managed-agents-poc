/**
 * Workflow serialization / deserialization.
 *
 * Converts between React Flow state (nodes + edges) and
 * the WorkflowSchema shape the server API expects.
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
  meta: { id?: string; name: string; version?: string }
): WorkflowSchema {
  // Default entryNodeId to first input node
  const inputNode = nodes.find((n) => n.type === "input");
  const entryNodeId = inputNode?.id ?? nodes[0]?.id ?? "";

  const schemaNodes: WorkflowNode[] = nodes.map((n) => {
    const data = n.data as unknown as WorkflowNodeData;
    const config = { ...data.config };
    // Persist editor position in config so layout survives round-trips
    (config as Record<string, unknown>).__editorPosition = { x: n.position.x, y: n.position.y };

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
  }));

  return {
    id: meta.id || `wf-${crypto.randomId()}`,
    name: meta.name,
    version: meta.version || "1",
    entryNodeId,
    nodes: schemaNodes,
    edges: schemaEdges,
  };
}

/**
 * Deserialize a WorkflowSchema into React Flow nodes + edges.
 */
export function deserializeWorkflow(schema: WorkflowSchema): {
  nodes: Node[];
  edges: Edge[];
} {
  let yOffset = 0;

  const nodes = schema.nodes.map((wn, index) => {
    const pos = (wn.config as Record<string, unknown>).__editorPosition as
      | { x: number; y: number }
      | undefined;

    // Strip __editorPosition from config before storing in data
    const config = { ...wn.config };
    delete (config as Record<string, unknown>).__editorPosition;

    const position = pos ?? { x: 250, y: yOffset + index * 150 };

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
  }));

  return { nodes: nodes as unknown as Node[], edges };
}
