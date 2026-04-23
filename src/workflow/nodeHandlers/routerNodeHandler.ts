/**
 * Router Node Handler — LLM-classified N-way branch.
 *
 * Runs a one-shot Claude call (not a managed-agent session — routing is
 * a pure classification task) that must output exactly one label from
 * the configured set. Outgoing edges whose `condition` matches the
 * emitted label stay alive; all others are pruned.
 */
import { anthropic } from "../../config/anthropic";
import type {
  WorkflowNode,
  RunContext,
  HandlerOptions,
  StepResult,
  RouterNodeConfig,
} from "../types";
import { resolveInputMapping, substituteTemplate } from "../resolveInputMapping";

const DEFAULT_MODEL = "claude-opus-4-7";

export async function runRouterNode(
  node: WorkflowNode,
  ctx: RunContext,
  _opts: HandlerOptions
): Promise<StepResult> {
  const config = node.config as RouterNodeConfig;
  if (!Array.isArray(config.labels) || config.labels.length === 0) {
    throw new Error(`Router node "${node.id}" missing 'labels'`);
  }
  if (!config.instructions) {
    throw new Error(`Router node "${node.id}" missing 'instructions'`);
  }

  const resolvedInputs = config.inputMapping
    ? resolveInputMapping(config.inputMapping, ctx)
    : {};
  const systemPrompt = substituteTemplate(config.instructions, resolvedInputs);

  const userContent =
    Object.keys(resolvedInputs).length > 0
      ? `Context:\n${JSON.stringify(resolvedInputs, null, 2)}\n\nRespond with EXACTLY ONE label from this set (case-insensitive, no punctuation, no extra text): ${config.labels.join(", ")}`
      : `Respond with EXACTLY ONE label from this set: ${config.labels.join(", ")}`;

  const response = await anthropic.messages.create({
    model: config.model ?? DEFAULT_MODEL,
    max_tokens: 20,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  const raw = response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim()
    .toLowerCase();

  // Forgiving parser: find the first label that appears in the response
  const matched = config.labels.find((label) =>
    raw.includes(label.toLowerCase())
  );

  if (!matched) {
    throw new Error(
      `Router node "${node.id}" — model emitted "${raw}" which doesn't match any of: ${config.labels.join(", ")}`
    );
  }

  return {
    outputs: {
      label: matched,
      chosenEdgeLabels: [matched],
    },
  };
}
