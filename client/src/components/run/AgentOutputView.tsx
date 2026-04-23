import Skeleton from "@mui/material/Skeleton";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import ReactMarkdown from "react-markdown";
import JsonBlock from "./JsonBlock";
import type { RunStep } from "../../types";

interface AgentOutputViewProps {
  step: RunStep;
  nodeType: string;
}

/**
 * Smart output renderer for step detail view.
 * - Running: pulsing skeleton loader
 * - Failed: red error alert with error_message
 * - Completed agent: markdown-rendered text output
 * - Completed other: pretty-printed JSON
 */
export default function AgentOutputView({ step, nodeType }: AgentOutputViewProps) {
  if (step.status === "running") {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <Skeleton variant="rectangular" height={20} animation="pulse" />
        <Skeleton variant="rectangular" height={20} width="80%" animation="pulse" />
        <Skeleton variant="rectangular" height={20} width="60%" animation="pulse" />
      </Box>
    );
  }

  if (step.status === "failed") {
    return (
      <Alert
        severity="error"
        variant="outlined"
        sx={{
          "& .MuiAlert-message": {
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontFamily: "monospace",
            fontSize: "0.8rem",
            overflow: "auto",
            maxHeight: 400,
            width: "100%",
          },
        }}
      >
        {step.error_message ?? "Unknown error"}
        {step.error_stack && (
          <Box
            component="pre"
            sx={{ mt: 1, fontSize: "0.7rem", opacity: 0.75, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
          >
            {step.error_stack}
          </Box>
        )}
      </Alert>
    );
  }

  // Completed — parse output_json
  if (!step.output_json) {
    return <JsonBlock value={null} label="Output" />;
  }

  let output: Record<string, unknown>;
  try {
    output = JSON.parse(step.output_json);
  } catch {
    return <JsonBlock value={step.output_json} label="Output (raw)" />;
  }

  // Detect truncated output
  if (output._truncated) {
    return <JsonBlock value={step.output_json} label="Output (truncated)" />;
  }

  // Agent nodes: render text as markdown
  if (nodeType === "agent" && typeof output.text === "string") {
    return (
      <Box
        sx={{
          "& pre": {
            bgcolor: "grey.100",
            p: 1.5,
            borderRadius: 1,
            overflow: "auto",
            fontFamily: "'Fira Code', 'Consolas', monospace",
            fontSize: "0.8rem",
          },
          "& code": {
            fontFamily: "'Fira Code', 'Consolas', monospace",
            fontSize: "0.85rem",
            bgcolor: "grey.100",
            px: 0.5,
            borderRadius: 0.5,
          },
          "& p": { mt: 0, mb: 1 },
          "& h1, & h2, & h3": { mt: 1.5, mb: 0.5 },
          "& ul, & ol": { mt: 0, mb: 1, pl: 3 },
          "& blockquote": {
            borderLeft: 3,
            borderColor: "primary.light",
            pl: 2,
            ml: 0,
            color: "text.secondary",
          },
          maxHeight: 500,
          overflow: "auto",
        }}
      >
        <ReactMarkdown>{output.text}</ReactMarkdown>
      </Box>
    );
  }

  // Other node types: formatted JSON
  return <JsonBlock value={step.output_json} label="Output" />;
}
