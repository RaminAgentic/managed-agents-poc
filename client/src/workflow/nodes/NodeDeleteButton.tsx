import { useCallback, type FC } from "react";
import { useReactFlow } from "@xyflow/react";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";

interface NodeDeleteButtonProps {
  nodeId: string;
  visible: boolean;
}

/**
 * Small "X" button positioned at the top-right of a workflow node.
 * Visible only when the node is selected. Clicking it removes the node
 * and all connected edges from the canvas.
 */
const NodeDeleteButton: FC<NodeDeleteButtonProps> = ({ nodeId, visible }) => {
  const { setNodes, setEdges } = useReactFlow();

  const handleDelete = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) =>
        eds.filter((e) => e.source !== nodeId && e.target !== nodeId)
      );
    },
    [nodeId, setNodes, setEdges]
  );

  if (!visible) return null;

  return (
    <IconButton
      size="small"
      onClick={handleDelete}
      title="Delete node"
      aria-label="Delete node"
      className="node-delete-btn"
      sx={{
        position: "absolute",
        top: -10,
        right: -10,
        width: 22,
        height: 22,
        bgcolor: "#ef4444",
        color: "#fff",
        border: "2px solid #fff",
        boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
        zIndex: 10,
        "&:hover": {
          bgcolor: "#dc2626",
        },
        "& .MuiSvgIcon-root": {
          fontSize: 14,
        },
      }}
    >
      <CloseIcon />
    </IconButton>
  );
};

export default NodeDeleteButton;
