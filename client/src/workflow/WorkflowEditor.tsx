import { useCallback, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  MarkerType,
  type Connection,
  type Node,
  type Edge,
} from "@xyflow/react";
import Box from "@mui/material/Box";
import { nodeTypes } from "./nodeTypes";
import { edgeTypes } from "./edgeTypes";
import NodePalette from "./NodePalette";
import Inspector from "./Inspector";
import WorkflowToolbar from "./WorkflowToolbar";
import type { NodeType, WorkflowNodeData } from "./types";
import "./workflow.css";

const defaultNodeData: Record<NodeType, () => WorkflowNodeData> = {
  input: () => ({
    name: "Input",
    nodeType: "input",
    config: { requiredFields: [] },
  }),
  agent: () => ({
    name: "Agent",
    nodeType: "agent",
    config: { instructions: "", inputMapping: {}, timeoutSeconds: 300, outputFormat: "text" as const },
    modelConfig: { effort: "xhigh" as const },
  }),
  gate: () => ({
    name: "Gate",
    nodeType: "gate",
    config: { expression: "" },
  }),
  router: () => ({
    name: "Router",
    nodeType: "router",
    config: { instructions: "", labels: [], inputMapping: {} },
  }),
  human_gate: () => ({
    name: "Human Gate",
    nodeType: "human_gate",
    config: {
      channel: "",
      messageTemplate: "",
      decisionValues: ["approve", "reject"],
      timeoutSeconds: 600,
    },
  }),
  finalize: () => ({
    name: "Finalize",
    nodeType: "finalize",
    config: { summaryFields: [] },
  }),
};

let nodeIdCounter = 0;
function getNextId() {
  return `node_${Date.now()}_${nodeIdCounter++}`;
}

function EditorCanvas() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const { screenToFlowPosition } = useReactFlow();

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge({ ...connection, type: "deletable" }, eds));
    },
    [setEdges]
  );

  const onEdgesDelete = useCallback(
    (deletedEdges: Edge[]) => {
      const deletedIds = new Set(deletedEdges.map((e) => e.id));
      setEdges((eds) => eds.filter((e) => !deletedIds.has(e.id)));
    },
    [setEdges]
  );

  const onNodesDelete = useCallback(
    (deletedNodes: Node[]) => {
      const deletedIds = new Set(deletedNodes.map((n) => n.id));
      // Clear inspector if the deleted node was selected
      setSelectedNodeId((prev) => (prev && deletedIds.has(prev) ? null : prev));
      // Remove any edges connected to deleted nodes
      setEdges((eds) =>
        eds.filter((e) => !deletedIds.has(e.source) && !deletedIds.has(e.target))
      );
    },
    [setEdges]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/reactflow") as NodeType;
      if (!type) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode: Node = {
        id: getNextId(),
        type,
        position,
        data: defaultNodeData[type]() as unknown as Record<string, unknown>,
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [screenToFlowPosition, setNodes]
  );

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const updateNodeData = useCallback(
    (nodeId: string, patch: Partial<WorkflowNodeData>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n
        )
      );
    },
    [setNodes]
  );

  const selectedNode = selectedNodeId
    ? nodes.find((n) => n.id === selectedNodeId) ?? null
    : null;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <WorkflowToolbar nodes={nodes} edges={edges} setNodes={setNodes} setEdges={setEdges} />
      <Box sx={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <NodePalette />
        <Box ref={reactFlowWrapper} sx={{ flex: 1 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onEdgesDelete={onEdgesDelete}
            onNodesDelete={onNodesDelete}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={{
              type: 'deletable',
              style: { stroke: '#94a3b8', strokeWidth: 2 },
              markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
            }}
            connectionLineStyle={{ stroke: '#94a3b8', strokeWidth: 2 }}
            fitView
            deleteKeyCode={["Backspace", "Delete"]}
          >
            <Controls />
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          </ReactFlow>
        </Box>
        {selectedNode && (
          <Inspector
            node={selectedNode}
            updateNodeData={updateNodeData}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </Box>
    </Box>
  );
}

export default function WorkflowEditor() {
  return (
    <ReactFlowProvider>
      <EditorCanvas />
    </ReactFlowProvider>
  );
}
