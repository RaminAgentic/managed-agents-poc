import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import InputIcon from "@mui/icons-material/Login";
import NodeDeleteButton from "./NodeDeleteButton";
import type { WorkflowNodeData, InputNodeConfig } from "../types";

const COLOR = "#2196f3"; // theme primary

function InputNode({ id, data, selected }: NodeProps & { data: WorkflowNodeData }) {
  const config = data.config as InputNodeConfig;
  const fields = config.requiredFields ?? [];

  return (
    <Paper
      elevation={selected ? 4 : 1}
      sx={{
        position: "relative",
        minWidth: 180,
        borderLeft: `4px solid ${COLOR}`,
        p: 1.5,
        bgcolor: selected ? "rgba(33,150,243,0.06)" : "background.paper",
        transition: "box-shadow 0.2s, background-color 0.2s",
      }}
    >
      <NodeDeleteButton nodeId={id} visible={!!selected} />
      <Typography
        variant="caption"
        sx={{
          color: COLOR,
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          mb: 0.5,
        }}
      >
        <InputIcon sx={{ fontSize: 14 }} /> INPUT
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        {data.name || "Input Node"}
      </Typography>
      {fields.length > 0 && (
        <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2, "& li": { fontSize: "0.75rem", color: "text.secondary" } }}>
          {fields.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </Box>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: COLOR }} />
    </Paper>
  );
}

export default memo(InputNode);
