/**
 * Agent Node Handler
 *
 * Executes a Claude API call for an agent-type workflow node.
 *
 * Responsibilities:
 * 1. Resolve inputMapping values from the run context
 * 2. Substitute {{variable}} placeholders in the instruction template
 * 3. Create a new Anthropic client instance (one per step)
 * 4. Call messages.create with the configured model + parameters
 * 5. Honor timeoutSeconds via Promise.race
 * 6. Parse and return the text response as outputs
 * 7. Store agentSessionId on the RunStep
 *
 * Note: The Promise.race timeout does NOT cancel the underlying HTTP
 * request — acceptable for POC. Upgrade to AbortController in follow-up.
 */
import Anthropic from "@anthropic-ai/sdk";
import type {
  WorkflowNode,
  RunContext,
  HandlerOptions,
  StepResult,
  AgentNodeConfig,
} from "../types";
import { createAnthropicClient } from "../../config/anthropic";
import { resolveInputMapping, substituteTemplate } from "../resolveInputMapping";
import { setStepAgentSession } from "../persistence";

const DEFAULT_MODEL = "claude-sonnet-4-5";
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_SECONDS = 120;

/**
 * Determine which beta headers to include based on model config.
 */
function resolveBetas(
  effort?: string
): string[] | undefined {
  if (effort === "xhigh" || effort === "max") {
    return ["interleaved-thinking-2025-05-14"];
  }
  return undefined;
}

export async function runAgentNode(
  node: WorkflowNode,
  ctx: RunContext,
  opts: HandlerOptions
): Promise<StepResult> {
  const config = node.config as AgentNodeConfig;
  const model = node.modelConfig?.model ?? DEFAULT_MODEL;
  const maxTokens = node.modelConfig?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const timeoutSeconds = config.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  const betas = resolveBetas(node.modelConfig?.effort);

  console.log(`[agentNodeHandler] Node "${node.id}" — model: ${model}, timeout: ${timeoutSeconds}s`);

  // Step 1: Resolve input mapping
  const resolvedInputs = config.inputMapping
    ? resolveInputMapping(config.inputMapping, ctx)
    : {};

  console.log(`[agentNodeHandler] Resolved inputs:`, Object.keys(resolvedInputs));

  // Step 2: Substitute template variables in instructions
  const systemPrompt = config.instructions
    ? substituteTemplate(config.instructions, resolvedInputs)
    : "You are a helpful assistant.";

  // Step 3: Build user message content from resolved inputs
  const userContent =
    Object.keys(resolvedInputs).length > 0
      ? `Here is the context for this task:\n\n${JSON.stringify(resolvedInputs, null, 2)}`
      : "Please proceed with the task described in your instructions.";

  // Step 4: Create a new Anthropic client for this step
  const client = createAnthropicClient();

  // Step 5: Build the API call
  const apiCallParams: Anthropic.MessageCreateParams = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  };

  // Step 6: Execute with timeout via Promise.race
  const timeoutMs = timeoutSeconds * 1000;

  const apiCall = betas
    ? client.beta.messages.create({
        ...apiCallParams,
        betas,
      })
    : client.messages.create(apiCallParams);

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    setTimeout(
      () => reject(new Error(`Agent node "${node.id}" timed out after ${timeoutSeconds}s`)),
      timeoutMs
    );
  });

  const response = await Promise.race([apiCall, timeoutPromise]);

  // Step 7: Store agent session ID
  const agentSessionId = response.id;
  if (agentSessionId) {
    await setStepAgentSession(opts.stepId, agentSessionId);
  }

  console.log(`[agentNodeHandler] Response ID: ${agentSessionId}, stop_reason: ${response.stop_reason}`);

  // Step 8: Parse output — concatenate all text blocks
  const textContent = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  // For v1, always return raw text. JSON parsing is a follow-up.
  const outputs: Record<string, unknown> = {
    text: textContent,
  };

  // If outputFormat is JSON, attempt to parse but don't fail on error
  if (config.outputFormat === "json") {
    try {
      outputs.parsed = JSON.parse(textContent);
    } catch {
      console.warn(
        `[agentNodeHandler] Node "${node.id}" outputFormat is 'json' but response is not valid JSON`
      );
    }
  }

  return { outputs };
}
