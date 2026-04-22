import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import LoginIcon from "@mui/icons-material/Login";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import PersonIcon from "@mui/icons-material/Person";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CallSplitIcon from "@mui/icons-material/CallSplit";
import AltRouteIcon from "@mui/icons-material/AltRoute";
import type { NodeType } from "./types";

interface PaletteItem {
  type: NodeType;
  label: string;
  color: string;
  icon: React.ReactNode;
}

const items: PaletteItem[] = [
  { type: "input",      label: "Input",       color: "#2196f3", icon: <LoginIcon sx={{ fontSize: 18 }} /> },
  { type: "agent",      label: "Agent",       color: "#7c4dff", icon: <SmartToyIcon sx={{ fontSize: 18 }} /> },
  { type: "gate",       label: "Gate (T/F)",  color: "#9c27b0", icon: <CallSplitIcon sx={{ fontSize: 18 }} /> },
  { type: "router",     label: "Router",      color: "#0288d1", icon: <AltRouteIcon sx={{ fontSize: 18 }} /> },
  { type: "human_gate", label: "Human Gate",  color: "#ed6c02", icon: <PersonIcon sx={{ fontSize: 18 }} /> },
  { type: "finalize",   label: "Finalize",    color: "#2e7d32", icon: <CheckCircleIcon sx={{ fontSize: 18 }} /> },
];

export default function NodePalette() {
  const onDragStart = (event: React.DragEvent, nodeType: NodeType) => {
    event.dataTransfer.setData("application/reactflow", nodeType);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <Box
      sx={{
        width: 180,
        borderRight: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        overflow: "auto",
        flexShrink: 0,
      }}
    >
      <Typography variant="subtitle2" sx={{ p: 1.5, pb: 0.5, color: "text.secondary" }}>
        Node Palette
      </Typography>
      <List dense sx={{ px: 1 }}>
        {items.map((item) => (
          <ListItem key={item.type} disablePadding sx={{ mb: 0.5 }}>
            <Paper
              elevation={1}
              draggable
              onDragStart={(e) => onDragStart(e, item.type)}
              sx={{
                width: "100%",
                p: 1,
                cursor: "grab",
                borderLeft: `3px solid ${item.color}`,
                display: "flex",
                alignItems: "center",
                gap: 1,
                "&:hover": { bgcolor: "action.hover" },
                "&:active": { cursor: "grabbing" },
              }}
            >
              <Box sx={{ color: item.color, display: "flex" }}>{item.icon}</Box>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {item.label}
              </Typography>
            </Paper>
          </ListItem>
        ))}
      </List>
    </Box>
  );
}
