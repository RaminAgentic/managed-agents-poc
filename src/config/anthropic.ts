import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";

// Singleton Anthropic client — reuse across the agent loop.
// Do not export a factory; a single HTTP client instance is sufficient.
export const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });
