import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import InputIcon from "@mui/icons-material/Login";
import type { WorkflowNodeData } from "../types";

function InputNode({ data, selected }: NodeProps & { data: WorkflowNodeData }) {
  return (
    <Paper
      elevation={selected ? 4 : 1}
      sx={{
        minWidth: 160,
        borderLeft: "4px solid #2196f3",
        p: 1.5,
        bgcolor: selected ? "rgba(33,150,243,0.06)" : "background.paper",
        transition: "box-shadow 0.2s, background-color 0.2s",
      }}
    >
      <Typography
        variant="caption"
        sx={{ color: "#2196f3", fontWeight: 600, display: "flex", alignItems: "center", gap: 0.5, mb: 0.5 }}
      >
        <InputIcon sx={{ fontSize: 14 }} /> INPUT
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        {data.name || "Input Node"}
      </Typography>
      <Handle type="source" position={Position.Bottom} style={{ background: "#2196f3" }} />
    </Paper>
  );
}

export default memo(InputNode);
