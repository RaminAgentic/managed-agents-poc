import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Box from "@mui/material/Box";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import NodeDeleteButton from "./NodeDeleteButton";
import type { WorkflowNodeData, AgentNodeConfig } from "../types";

const COLOR = "#7c4dff"; // theme secondary / purple

function AgentNode({ id, data, selected }: NodeProps & { data: WorkflowNodeData }) {
  const config = data.config as AgentNodeConfig;
  const effort = data.modelConfig?.effort ?? "xhigh";
  const agentRef = config.agentRef;

  return (
    <Paper
      elevation={selected ? 4 : 1}
      sx={{
        position: "relative",
        minWidth: 180,
        borderLeft: `4px solid ${COLOR}`,
        p: 1.5,
        bgcolor: selected ? "rgba(124,77,255,0.06)" : "background.paper",
        transition: "box-shadow 0.2s, background-color 0.2s",
      }}
    >
      <NodeDeleteButton nodeId={id} visible={!!selected} />
      <Handle type="target" position={Position.Top} style={{ background: COLOR }} />
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
        <SmartToyIcon sx={{ fontSize: 14 }} /> AGENT
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        {data.name || "Agent Node"}
      </Typography>
      {agentRef && (
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 0.25 }}>
          ref: {agentRef}
        </Typography>
      )}
      <Box sx={{ mt: 0.5 }}>
        <Chip
          label={effort}
          size="small"
          sx={{
            height: 20,
            fontSize: "0.65rem",
            fontWeight: 600,
            bgcolor: `${COLOR}20`,
            color: COLOR,
          }}
        />
      </Box>
      <Handle type="source" position={Position.Bottom} style={{ background: COLOR }} />
    </Paper>
  );
}

export default memo(AgentNode);
