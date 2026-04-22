import { NavLink, Outlet } from "react-router-dom";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Badge from "@mui/material/Badge";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import ChatIcon from "@mui/icons-material/Chat";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import PlaylistPlayIcon from "@mui/icons-material/PlaylistPlay";
import { useActiveRunCount } from "./hooks/useActiveRunCount";

function NavButton({
  to,
  icon,
  label,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Button
      component={NavLink}
      to={to}
      startIcon={icon}
      sx={{
        textTransform: "none",
        fontWeight: 500,
        color: "inherit",
        opacity: 0.7,
        "&.active": {
          opacity: 1,
          borderBottom: "2px solid",
          borderColor: "secondary.main",
          borderRadius: 0,
        },
      }}
    >
      {label}
    </Button>
  );
}

export default function App() {
  const activeRunCount = useActiveRunCount();

  return (
    <Box sx={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <AppBar position="static" elevation={1}>
        <Toolbar variant="dense">
          <SmartToyIcon sx={{ mr: 1 }} />
          <Typography
            variant="h6"
            component="div"
            sx={{ fontSize: "1.1rem", mr: 3 }}
          >
            Workflow Workbench
          </Typography>

          <NavButton
            to="/"
            icon={<AccountTreeIcon sx={{ fontSize: 18 }} />}
            label="Editor"
          />
          <NavButton
            to="/runs"
            icon={
              <Badge
                badgeContent={activeRunCount}
                color="secondary"
                invisible={activeRunCount === 0}
                sx={{
                  "& .MuiBadge-badge": {
                    fontSize: "0.65rem",
                    minWidth: 16,
                    height: 16,
                  },
                }}
              >
                <PlaylistPlayIcon sx={{ fontSize: 18 }} />
              </Badge>
            }
            label="Run History"
          />
          <NavButton
            to="/chat"
            icon={<ChatIcon sx={{ fontSize: 18 }} />}
            label="Chat"
          />
        </Toolbar>
      </AppBar>

      <Box sx={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <Outlet />
      </Box>
    </Box>
  );
}
