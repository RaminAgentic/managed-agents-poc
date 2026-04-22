import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import AltRouteIcon from "@mui/icons-material/AltRoute";
import NodeDeleteButton from "./NodeDeleteButton";
import type { WorkflowNodeData, RouterNodeConfig } from "../types";

const COLOR = "#0288d1";

function RouterNode({ id, data, selected }: NodeProps & { data: WorkflowNodeData }) {
  const config = data.config as RouterNodeConfig;
  const labels = config.labels ?? [];

  return (
    <Paper
      elevation={selected ? 4 : 1}
      sx={{
        position: "relative",
        minWidth: 200,
        borderLeft: `4px solid ${COLOR}`,
        p: 1.5,
        bgcolor: selected ? "rgba(2,136,209,0.06)" : "background.paper",
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
        <AltRouteIcon sx={{ fontSize: 14 }} /> ROUTER
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        {data.name || "Router"}
      </Typography>

      {labels.length > 0 && (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.25, mt: 0.75 }}>
          {labels.map((l) => (
            <Chip
              key={l}
              label={l}
              size="small"
              variant="outlined"
              sx={{ fontSize: "0.65rem", height: 18 }}
            />
          ))}
        </Box>
      )}

      {/* One outgoing handle per label. React Flow supports multiple source
          handles; the edge carries `sourceHandle` matching the label. */}
      {labels.length === 0 ? (
        <Handle type="source" position={Position.Bottom} style={{ background: COLOR }} />
      ) : (
        labels.map((l, i) => {
          const pct = ((i + 1) / (labels.length + 1)) * 100;
          return (
            <Handle
              key={l}
              type="source"
              position={Position.Bottom}
              id={l}
              style={{
                background: COLOR,
                left: `${pct}%`,
              }}
            />
          );
        })
      )}
    </Paper>
  );
}

export default memo(RouterNode);
