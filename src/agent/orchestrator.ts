import Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "../config/anthropic";
import { runAgent } from "./runAgent";
import { runResearchAgent } from "./researchAgent";

const MODEL = "claude-opus-4-7";

/**
 * System prompt for the intent classifier.
 * Forces the model to respond with a single routing label.
 *
 * Note: The classifier intentionally uses the lightweight messages.create
 * API — it's a single-shot, no-tool call that doesn't benefit from a
 * managed agent session.
 */
const CLASSIFIER_SYSTEM =
  "Classify the user's request into exactly one category. " +
  "Respond with ONLY one word, no punctuation, no explanation:\n" +
  "- weather: questions about current weather, temperature, forecast\n" +
  "- research: factual questions, explanations, summaries, 'tell me about', 'explain'\n" +
  "- other: anything else";

/** Routing label returned by the classifier. */
export type AgentType = "weather" | "research" | "other";

/** Structured result from the orchestrator. */
export interface OrchestratorResult {
  response: string;
  agentType: AgentType;
}

/**
 * Orchestrator: Claude-to-Claude delegation pattern.
 *
 * 1. Classifies the user's intent via a single messages.create call (no tools).
 * 2. Logs the routing decision.
 * 3. Delegates to the appropriate managed agent session and returns its
 *    response wrapped in an OrchestratorResult (includes agentType for the
 *    web UI).
 *
 * Cost note: This adds one extra (cheap) classifier call per user prompt.
 * Acceptable for POC; production would cache or inline routing.
 */
export async function runOrchestrator(
  userPrompt: string
): Promise<OrchestratorResult> {
  if (!userPrompt.trim()) {
    throw new Error("Empty prompt — nothing to classify.");
  }

  // --- Step 1: Classify intent (lightweight, no managed session needed) ---
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
  const label = (rawLabel.match(/weather|research/)?.[0] ?? "other") as AgentType;

  // --- Step 2: Log routing decision ---
  console.log(`\n━━━ Orchestrator: classified as "${label}" ━━━`);
  console.log(
    `→ routing to managed agent session: ${
      label === "weather" ? "weather-agent" : "research-agent"
    }`
  );

  // --- Step 3: Delegate to managed agent session ---
  switch (label) {
    case "weather":
      return { response: await runAgent(userPrompt), agentType: "weather" };
    case "research":
      return {
        response: await runResearchAgent(userPrompt),
        agentType: "research",
      };
    default:
      // Default to research agent — handles open-ended prompts gracefully
      return {
        response: await runResearchAgent(userPrompt),
        agentType: "other",
      };
  }
}
