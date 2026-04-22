import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import PersonIcon from "@mui/icons-material/Person";
import NodeDeleteButton from "./NodeDeleteButton";
import type { WorkflowNodeData, HumanGateNodeConfig } from "../types";

const COLOR = "#ed6c02"; // warning / yellow-orange

function HumanGateNode({ id, data, selected }: NodeProps & { data: WorkflowNodeData }) {
  const config = data.config as HumanGateNodeConfig;
  const channel = config.channel;

  return (
    <Paper
      elevation={selected ? 4 : 1}
      sx={{
        position: "relative",
        minWidth: 180,
        borderLeft: `4px solid ${COLOR}`,
        p: 1.5,
        bgcolor: selected ? "rgba(237,108,2,0.06)" : "background.paper",
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
        <PersonIcon sx={{ fontSize: 14 }} /> HUMAN GATE
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        {data.name || "Human Gate"}
      </Typography>
      {channel && (
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 0.25 }}>
          #{channel}
        </Typography>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: COLOR }} />
    </Paper>
  );
}

export default memo(HumanGateNode);
