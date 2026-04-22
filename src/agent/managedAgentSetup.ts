import { anthropic } from "../config/anthropic";

/**
 * Lazy singleton setup for Managed Agents resources.
 *
 * Creates one cloud environment, one weather agent (with a custom tool),
 * and one research agent. All are created on first use and cached for
 * subsequent requests, as recommended by the managed agents docs.
 *
 * Each user message creates a *new session* but reuses these long-lived
 * agent/environment resources.
 */

const MODEL = "claude-sonnet-4-5";

// --- Cached resource IDs (created lazily on first call) ---
let weatherAgentId: string | null = null;
let researchAgentId: string | null = null;
let environmentId: string | null = null;

// Prevent concurrent initialization races
let envPromise: Promise<string> | null = null;
let weatherPromise: Promise<string> | null = null;
let researchPromise: Promise<string> | null = null;

// --- Prompts ---
const WEATHER_SYSTEM_PROMPT =
  "You are a helpful assistant with access to tools. " +
  "When a user asks a question that a tool can answer, call the tool. " +
  "Otherwise reply directly and concisely.";

const RESEARCH_SYSTEM_PROMPT =
  "You are a research assistant. Given a topic or question, return a clear, " +
  "factual, concise answer in 1-3 short paragraphs. No preamble, no caveats " +
  "unless necessary.";

// ── Environment ────────────────────────────────────────────────────
export async function getEnvironmentId(): Promise<string> {
  if (environmentId) return environmentId;
  if (envPromise) return envPromise;

  envPromise = (async () => {
    console.log("\n━━━ Creating managed environment ━━━");
    const env = await anthropic.beta.environments.create({
      name: "managed-agents-poc-env",
      config: {
        type: "cloud",
        networking: { type: "unrestricted" },
      },
    });
    environmentId = env.id;
    console.log(`✓ Environment created: ${environmentId}`);
    return environmentId;
  })();

  return envPromise;
}

// ── Weather Agent ──────────────────────────────────────────────────
export async function getWeatherAgentId(): Promise<string> {
  if (weatherAgentId) return weatherAgentId;
  if (weatherPromise) return weatherPromise;

  weatherPromise = (async () => {
    console.log("\n━━━ Creating weather agent ━━━");
    const agent = await anthropic.beta.agents.create({
      name: "weather-agent",
      model: MODEL,
      system: WEATHER_SYSTEM_PROMPT,
      tools: [
        { type: "agent_toolset_20260401" },
        {
          type: "custom",
          name: "get_weather",
          description:
            "Get the current weather for a given location. Returns temperature and conditions.",
          input_schema: {
            type: "object",
            properties: {
              location: {
                type: "string",
                description: "City name, e.g., 'San Francisco' or 'Paris, FR'",
              },
              unit: {
                type: "string",
                description: "Temperature unit (defaults to celsius)",
              },
            },
            required: ["location"],
          },
        },
      ],
    });
    weatherAgentId = agent.id;
    console.log(`✓ Weather agent created: ${weatherAgentId}`);
    return weatherAgentId;
  })();

  return weatherPromise;
}

// ── Research Agent ─────────────────────────────────────────────────
export async function getResearchAgentId(): Promise<string> {
  if (researchAgentId) return researchAgentId;
  if (researchPromise) return researchPromise;

  researchPromise = (async () => {
    console.log("\n━━━ Creating research agent ━━━");
    const agent = await anthropic.beta.agents.create({
      name: "research-agent",
      model: MODEL,
      system: RESEARCH_SYSTEM_PROMPT,
      tools: [{ type: "agent_toolset_20260401" }],
    });
    researchAgentId = agent.id;
    console.log(`✓ Research agent created: ${researchAgentId}`);
    return researchAgentId;
  })();

  return researchPromise;
}
