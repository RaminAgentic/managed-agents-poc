import Chip from "@mui/material/Chip";
import type { RunStatus, StepStatus } from "../../types";

const STATUS_COLOR: Record<string, "default" | "info" | "success" | "error"> = {
  pending: "default",
  running: "info",
  completed: "success",
  failed: "error",
};

interface RunStatusChipProps {
  status: RunStatus | StepStatus;
  size?: "small" | "medium";
}

export default function RunStatusChip({ status, size = "small" }: RunStatusChipProps) {
  return (
    <Chip
      label={status}
      size={size}
      color={STATUS_COLOR[status] ?? "default"}
      sx={{
        fontWeight: 600,
        textTransform: "capitalize",
        ...(status === "running" && {
          animation: "pulse 1.5s ease-in-out infinite",
          "@keyframes pulse": {
            "0%, 100%": { opacity: 1 },
            "50%": { opacity: 0.6 },
          },
        }),
      }}
    />
  );
}
