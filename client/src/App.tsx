import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import ChatView from "./components/ChatView";

export default function App() {
  return (
    <Box sx={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <AppBar position="static" elevation={1}>
        <Toolbar variant="dense">
          <SmartToyIcon sx={{ mr: 1 }} />
          <Typography variant="h6" component="div" sx={{ fontSize: "1.1rem" }}>
            Managed Agents POC
          </Typography>
        </Toolbar>
      </AppBar>

      <Box sx={{ flex: 1, overflow: "hidden" }}>
        <ChatView />
      </Box>
    </Box>
  );
}
