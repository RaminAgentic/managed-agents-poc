import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import PersonIcon from "@mui/icons-material/Person";
import type { WorkflowNodeData } from "../types";

function HumanGateNode({ data, selected }: NodeProps & { data: WorkflowNodeData }) {
  return (
    <Paper
      elevation={selected ? 4 : 1}
      sx={{
        minWidth: 160,
        borderLeft: "4px solid #ed6c02",
        p: 1.5,
        bgcolor: selected ? "rgba(237,108,2,0.06)" : "background.paper",
        transition: "box-shadow 0.2s, background-color 0.2s",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: "#ed6c02" }} />
      <Typography
        variant="caption"
        sx={{ color: "#ed6c02", fontWeight: 600, display: "flex", alignItems: "center", gap: 0.5, mb: 0.5 }}
      >
        <PersonIcon sx={{ fontSize: 14 }} /> HUMAN GATE
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        {data.name || "Human Gate"}
      </Typography>
      <Handle type="source" position={Position.Bottom} style={{ background: "#ed6c02" }} />
    </Paper>
  );
}

export default memo(HumanGateNode);
