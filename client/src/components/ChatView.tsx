import { useState, useCallback } from "react";
import Box from "@mui/material/Box";
import MessageList from "./MessageList";
import ChatInput from "./ChatInput";
import { postChat } from "../api/chat";
import type { Message, AgentType } from "../types";

function uuid(): string {
  return crypto.randomUUID();
}

export default function ChatView() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState(false);

  const handleSend = useCallback(async (text: string) => {
    const userMsg: Message = {
      id: uuid(),
      role: "user",
      text,
    };

    const placeholderId = uuid();
    const placeholder: Message = {
      id: placeholderId,
      role: "assistant",
      text: "",
      pending: true,
    };

    setMessages((prev) => [...prev, userMsg, placeholder]);
    setPending(true);

    try {
      const data = await postChat(text);

      setMessages((prev) =>
        prev.map((m) =>
          m.id === placeholderId
            ? {
                ...m,
                text: data.response,
                agentType: (["weather", "research", "other"].includes(data.agentType)
                  ? data.agentType
                  : "other") as AgentType,
                pending: false,
              }
            : m
        )
      );
    } catch (err: unknown) {
      const errorText =
        err instanceof Error ? err.message : "An unexpected error occurred";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === placeholderId
            ? { ...m, text: `Error: ${errorText}`, pending: false }
            : m
        )
      );
    } finally {
      setPending(false);
    }
  }, []);

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <MessageList messages={messages} />
      <ChatInput onSend={handleSend} disabled={pending} />
    </Box>
  );
}
