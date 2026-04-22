import Chip from "@mui/material/Chip";
import CloudIcon from "@mui/icons-material/Cloud";
import SearchIcon from "@mui/icons-material/Search";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import type { AgentType } from "../types";

const META: Record<
  AgentType,
  { label: string; color: "primary" | "secondary" | "default"; icon: React.ReactElement }
> = {
  weather: {
    label: "weather-agent",
    color: "primary",
    icon: <CloudIcon fontSize="small" />,
  },
  research: {
    label: "research-agent",
    color: "secondary",
    icon: <SearchIcon fontSize="small" />,
  },
  other: {
    label: "orchestrator",
    color: "default",
    icon: <AutoAwesomeIcon fontSize="small" />,
  },
};

interface AgentBadgeProps {
  type: AgentType;
}

export default function AgentBadge({ type }: AgentBadgeProps) {
  const m = META[type];
  return (
    <Chip
      size="small"
      icon={m.icon}
      label={m.label}
      color={m.color}
      sx={{ mb: 0.5 }}
    />
  );
}
