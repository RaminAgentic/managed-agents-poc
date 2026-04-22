import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";

// Singleton Anthropic client — reuse across the agent loop.
export const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });

/**
 * Factory: creates a new Anthropic client instance.
 *
 * Per the Managed Agents spec, each agent step should use its own
 * client instance to avoid session contamination. Use this for
 * workflow agent nodes; use the singleton `anthropic` for one-shot calls.
 */
export function createAnthropicClient(): Anthropic {
  return new Anthropic({ apiKey: env.anthropicApiKey });
}
