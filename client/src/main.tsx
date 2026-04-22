import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import "@xyflow/react/dist/style.css";
import theme from "./theme";
import App from "./App";
import WorkflowEditor from "./workflow/WorkflowEditor";
import RunListPage from "./pages/RunListPage";
import RunDetailPage from "./pages/RunDetailPage";
import ChatView from "./components/ChatView";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          <Route element={<App />}>
            <Route path="/" element={<WorkflowEditor />} />
            <Route path="/runs" element={<RunListPage />} />
            <Route path="/runs/:runId" element={<RunDetailPage />} />
            <Route path="/chat" element={<ChatView />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>
);
