import Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "../config/anthropic";

const MODEL = "claude-sonnet-4-5";
const MAX_TOKENS = 1024;

const RESEARCH_SYSTEM_PROMPT =
  "You are a research assistant. Given a topic or question, return a clear, " +
  "factual, concise answer in 1-3 short paragraphs. No preamble, no caveats " +
  "unless necessary.";

/**
 * Single-shot research/summarization agent.
 *
 * No tools, no conversation loop — sends one user message and returns the
 * model's text response. Used by the orchestrator for knowledge/research tasks.
 */
export async function runResearchAgent(topic: string): Promise<string> {
  console.log("\n━━━ research-agent call ━━━");

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: RESEARCH_SYSTEM_PROMPT,
    messages: [{ role: "user", content: topic }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  console.log(`\n━━━ Research answer ━━━\n${text}\n━━━━━━━━━━━━━━━━━━━━`);
  return text;
}
