import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import CircularProgress from "@mui/material/CircularProgress";
import type { StepStatus } from "../../types";

interface StepStatusIconProps {
  status: StepStatus;
}

export default function StepStatusIcon({ status }: StepStatusIconProps) {
  switch (status) {
    case "completed":
      return <CheckCircleIcon color="success" sx={{ fontSize: 22 }} />;
    case "failed":
      return <ErrorIcon color="error" sx={{ fontSize: 22 }} />;
    case "running":
      return <CircularProgress size={20} color="info" />;
    default:
      return null;
  }
}
