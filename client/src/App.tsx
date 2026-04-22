import { useState } from "react";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import ChatIcon from "@mui/icons-material/Chat";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import ChatView from "./components/ChatView";
import WorkflowEditor from "./workflow/WorkflowEditor";

export default function App() {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <Box sx={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <AppBar position="static" elevation={1}>
        <Toolbar variant="dense">
          <SmartToyIcon sx={{ mr: 1 }} />
          <Typography variant="h6" component="div" sx={{ fontSize: "1.1rem", mr: 3 }}>
            Managed Agents POC
          </Typography>
          <Tabs
            value={activeTab}
            onChange={(_e, v) => setActiveTab(v)}
            textColor="inherit"
            indicatorColor="secondary"
            sx={{
              "& .MuiTab-root": { minHeight: 48, textTransform: "none", fontWeight: 500 },
            }}
          >
            <Tab icon={<ChatIcon sx={{ fontSize: 18 }} />} iconPosition="start" label="Chat" />
            <Tab icon={<AccountTreeIcon sx={{ fontSize: 18 }} />} iconPosition="start" label="Workflow Editor" />
          </Tabs>
        </Toolbar>
      </AppBar>

      <Box
        sx={{
          flex: 1,
          overflow: "hidden",
          display: activeTab === 0 ? "flex" : "none",
          flexDirection: "column",
        }}
      >
        <ChatView />
      </Box>
      <Box
        sx={{
          flex: 1,
          overflow: "hidden",
          display: activeTab === 1 ? "flex" : "none",
          flexDirection: "column",
        }}
      >
        <WorkflowEditor />
      </Box>
    </Box>
  );
}
