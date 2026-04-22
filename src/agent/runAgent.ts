import Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "../config/anthropic";
import { ConversationState } from "../data/conversationState";
import { SYSTEM_PROMPT } from "../data/prompts";
import { TOOLS } from "../data/tools";
import { dispatchTool } from "./toolDispatcher";

const MODEL = "claude-sonnet-4-5";
const MAX_TOKENS = 1024;

/**
 * Run the managed agent loop end-to-end.
 *
 * Seeds a conversation with the user prompt, then loops:
 *   1. Call messages.create with the full conversation history.
 *   2. If stop_reason is "tool_use", dispatch each tool_use block and
 *      append tool_result messages, then continue the loop.
 *   3. If stop_reason is "end_turn", extract text blocks and return.
 */
export async function runAgent(userPrompt: string): Promise<string> {
  const state = new ConversationState();
  state.addUserMessage(userPrompt);

  let turn = 0;

  while (true) {
    turn += 1;
    console.log(`\n━━━ Turn ${turn} — API call ━━━`);

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: state.getMessages(),
    });

    state.addAssistantMessage(response.content);

    // Log any tool_use blocks the model wants to invoke
    for (const block of response.content) {
      if (block.type === "tool_use") {
        console.log(`→ tool_use: ${block.name}`);
        console.log(`  input: ${JSON.stringify(block.input)}`);
      }
    }

    if (response.stop_reason === "end_turn") {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      console.log(`\n━━━ Final answer ━━━\n${text}\n━━━━━━━━━━━━━━━━━━━━`);
      return text;
    }

    if (response.stop_reason === "tool_use") {
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const result = dispatchTool(
          block.name,
          block.input as Record<string, unknown>
        );
        console.log(`← tool_result (${block.name}): ${result}`);
        state.addToolResult(block.id, result);
      }
      continue;
    }

    // Any other stop_reason (max_tokens, stop_sequence) is unexpected for POC
    throw new Error(`Unexpected stop_reason: ${response.stop_reason}`);
  }
}
