import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import type { WorkflowNodeData } from "../types";

function AgentNode({ data, selected }: NodeProps & { data: WorkflowNodeData }) {
  return (
    <Paper
      elevation={selected ? 4 : 1}
      sx={{
        minWidth: 160,
        borderLeft: "4px solid #7c4dff",
        p: 1.5,
        bgcolor: selected ? "rgba(124,77,255,0.06)" : "background.paper",
        transition: "box-shadow 0.2s, background-color 0.2s",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: "#7c4dff" }} />
      <Typography
        variant="caption"
        sx={{ color: "#7c4dff", fontWeight: 600, display: "flex", alignItems: "center", gap: 0.5, mb: 0.5 }}
      >
        <SmartToyIcon sx={{ fontSize: 14 }} /> AGENT
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        {data.name || "Agent Node"}
      </Typography>
      <Handle type="source" position={Position.Bottom} style={{ background: "#7c4dff" }} />
    </Paper>
  );
}

export default memo(AgentNode);
