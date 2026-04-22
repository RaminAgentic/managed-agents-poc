import type Anthropic from "@anthropic-ai/sdk";

/**
 * In-memory conversation history buffer.
 *
 * Accumulates user, assistant, and tool-result messages in the shape
 * required by the Anthropic Messages API. Sprint 2's agent loop mutates
 * this across turns to support multi-turn tool_use → tool_result cycles.
 */
export class ConversationState {
  private messages: Anthropic.MessageParam[] = [];

  /** Append a plain-text user message. */
  addUserMessage(text: string): void {
    this.messages.push({ role: "user", content: text });
  }

  /**
   * Append an assistant response.
   * Accepts the raw `response.content` array (which may contain mixed
   * text + tool_use blocks) so tool_use_ids are preserved verbatim.
   */
  addAssistantMessage(content: Anthropic.ContentBlock[]): void {
    this.messages.push({ role: "assistant", content });
  }

  /**
   * Append a tool result as a user message with a tool_result content block.
   * @param toolUseId - The id from the preceding tool_use block.
   * @param result    - Stringified JSON returned by the tool handler.
   */
  addToolResult(toolUseId: string, result: string): void {
    this.messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content: result,
        },
      ],
    });
  }

  /** Return the full message array for passing to messages.create(). */
  getMessages(): Anthropic.MessageParam[] {
    return this.messages;
  }

  /** Clear all messages (e.g., between sample prompts). */
  reset(): void {
    this.messages = [];
  }
}
