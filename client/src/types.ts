export type AgentType = "weather" | "research" | "other";

export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  agentType?: AgentType;
  pending?: boolean;
}

export interface ChatResponse {
  response: string;
  agentType: AgentType;
}
