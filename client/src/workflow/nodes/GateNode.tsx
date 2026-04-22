import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CallSplitIcon from "@mui/icons-material/CallSplit";
import NodeDeleteButton from "./NodeDeleteButton";
import type { WorkflowNodeData, GateNodeConfig } from "../types";

const COLOR = "#9c27b0";
const SIZE = 160;

/**
 * Gate node — rendered as a rotated square (diamond).
 * Incoming edge enters on the left; two outgoing edges exit on the right
 * (true at top-right, false at bottom-right).
 */
function GateNode({ id, data, selected }: NodeProps & { data: WorkflowNodeData }) {
  const config = data.config as GateNodeConfig;
  const expression = (config.expression ?? "").trim();
  const preview = expression
    ? expression.length > 28
      ? expression.slice(0, 25) + "…"
      : expression
    : "(no expression)";

  return (
    <Box
      sx={{
        position: "relative",
        width: SIZE,
        height: SIZE,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Diamond background */}
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          transform: "rotate(45deg)",
          borderRadius: "12px",
          border: `2px solid ${COLOR}`,
          bgcolor: selected ? "rgba(156,39,176,0.08)" : "background.paper",
          boxShadow: selected ? 4 : 1,
          transition: "box-shadow 0.2s, background-color 0.2s",
        }}
      />
      <NodeDeleteButton nodeId={id} visible={!!selected} />

      {/* Incoming (left) */}
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: COLOR, left: SIZE / 2 - 4 }}
      />

      {/* Outgoing — true (top-right) */}
      <Handle
        type="source"
        position={Position.Right}
        id="true"
        style={{
          background: "#22c55e",
          top: SIZE * 0.28,
        }}
      />
      {/* Outgoing — false (bottom-right) */}
      <Handle
        type="source"
        position={Position.Right}
        id="false"
        style={{
          background: "#ef4444",
          top: SIZE * 0.72,
        }}
      />

      {/* Labels */}
      <Typography
        sx={{
          position: "absolute",
          right: -14,
          top: SIZE * 0.26 - 8,
          fontSize: 11,
          fontWeight: 600,
          color: "#22c55e",
        }}
      >
        T
      </Typography>
      <Typography
        sx={{
          position: "absolute",
          right: -14,
          top: SIZE * 0.72 - 8,
          fontSize: 11,
          fontWeight: 600,
          color: "#ef4444",
        }}
      >
        F
      </Typography>

      {/* Foreground content */}
      <Box
        sx={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 0.5,
          px: 2,
          textAlign: "center",
        }}
      >
        <CallSplitIcon sx={{ color: COLOR, fontSize: 24 }} />
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {data.name || "Gate"}
        </Typography>
        <Typography
          variant="caption"
          sx={{
            color: "text.secondary",
            fontFamily: "monospace",
            fontSize: 10,
          }}
        >
          {preview}
        </Typography>
      </Box>
    </Box>
  );
}

export default memo(GateNode);
