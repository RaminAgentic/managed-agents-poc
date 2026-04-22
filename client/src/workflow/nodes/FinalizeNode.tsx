import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import NodeDeleteButton from "./NodeDeleteButton";

const COLOR = "#2e7d32"; // success green

function FinalizeNode({ id, selected }: NodeProps) {
  return (
    <Paper
      elevation={selected ? 4 : 1}
      sx={{
        position: "relative",
        minWidth: 160,
        borderLeft: `4px solid ${COLOR}`,
        p: 1.5,
        bgcolor: selected ? "rgba(46,125,50,0.06)" : "background.paper",
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
        <CheckCircleIcon sx={{ fontSize: 14 }} /> FINALIZE
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        Complete
      </Typography>
    </Paper>
  );
}

export default memo(FinalizeNode);
