// Static prompt data — no runtime side effects.
// Sprint 2's agent loop imports these directly.

export const SYSTEM_PROMPT: string =
  "You are a helpful assistant with access to tools. " +
  "When a user asks a question that a tool can answer, call the tool. " +
  "Otherwise reply directly and concisely.";

export const SAMPLE_USER_PROMPTS: readonly string[] = [
  "What's the weather in San Francisco right now?",
  "What's the weather in Paris in Celsius?",
  "Tell me a fun fact about octopuses.",
] as const;
