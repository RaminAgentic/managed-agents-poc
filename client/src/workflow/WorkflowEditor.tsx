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
  type Connection,
  type Node,
  type Edge,
} from "@xyflow/react";
import Box from "@mui/material/Box";
import { nodeTypes } from "./nodeTypes";
import NodePalette from "./NodePalette";
import Inspector from "./Inspector";
import WorkflowToolbar from "./WorkflowToolbar";
import type { NodeType, WorkflowNodeData } from "./types";

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
  human_gate: () => ({
    name: "Human Gate",
    nodeType: "human_gate",
    config: { channel: "", messageTemplate: "", decisionValues: ["approve", "reject"] },
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
      setEdges((eds) => addEdge(connection, eds));
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
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
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
