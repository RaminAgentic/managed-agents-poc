import Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "../config/anthropic";
import { runAgent } from "./runAgent";
import { runResearchAgent } from "./researchAgent";

const MODEL = "claude-sonnet-4-5";

/**
 * System prompt for the intent classifier.
 * Forces the model to respond with a single routing label.
 */
const CLASSIFIER_SYSTEM =
  "Classify the user's request into exactly one category. " +
  "Respond with ONLY one word, no punctuation, no explanation:\n" +
  "- weather: questions about current weather, temperature, forecast\n" +
  "- research: factual questions, explanations, summaries, 'tell me about', 'explain'\n" +
  "- other: anything else";

/**
 * Orchestrator: Claude-to-Claude delegation pattern.
 *
 * 1. Classifies the user's intent via a single messages.create call (no tools).
 * 2. Logs the routing decision.
 * 3. Delegates to the appropriate sub-agent and returns its response.
 *
 * Cost note: This adds one extra (cheap) classifier call per user prompt.
 * Acceptable for POC; production would cache or inline routing.
 */
export async function runOrchestrator(userPrompt: string): Promise<string> {
  if (!userPrompt.trim()) {
    throw new Error("Empty prompt — nothing to classify.");
  }

  // --- Step 1: Classify intent ---
  const classifierResponse = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 10,
    temperature: 0,
    system: CLASSIFIER_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  });

  const rawLabel = classifierResponse.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .toLowerCase()
    .trim();

  // Forgiving parser: extract a known label even if the model is verbose
  const label = rawLabel.match(/weather|research/)?.[0] ?? "other";

  // --- Step 2: Log routing decision (Task 4) ---
  console.log(`\n━━━ Orchestrator: classified as "${label}" ━━━`);
  console.log(
    `→ routing to: ${label === "weather" ? "weather-agent" : "research-agent"}`
  );

  // --- Step 3: Delegate to sub-agent ---
  switch (label) {
    case "weather":
      return runAgent(userPrompt);
    case "research":
      return runResearchAgent(userPrompt);
    default:
      // Default to research agent — it handles open-ended prompts gracefully
      return runResearchAgent(userPrompt);
  }
}
