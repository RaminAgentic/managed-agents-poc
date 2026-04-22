import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import AgentBadge from "./AgentBadge";
import LoadingIndicator from "./LoadingIndicator";
import type { Message } from "../types";

interface MessageBubbleProps {
  message: Message;
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isError = message.text.startsWith("Error:");

  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        mb: 1.5,
        px: 2,
      }}
    >
      <Paper
        elevation={1}
        sx={{
          maxWidth: "70%",
          p: 1.5,
          bgcolor: isUser
            ? "primary.main"
            : isError
              ? "#fef2f2"
              : "background.paper",
          color: isUser ? "#fff" : isError ? "#dc2626" : "text.primary",
          borderRadius: isUser
            ? "16px 16px 4px 16px"
            : "16px 16px 16px 4px",
        }}
      >
        {!isUser && message.agentType && !message.pending && (
          <AgentBadge type={message.agentType} />
        )}
        {message.pending ? (
          <LoadingIndicator />
        ) : (
          <Typography
            variant="body1"
            sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
          >
            {message.text}
          </Typography>
        )}
      </Paper>
    </Box>
  );
}
