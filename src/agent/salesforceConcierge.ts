/**
 * Salesforce Concierge — a single conversational managed agent the user
 * can talk to in plain English to get anything done in Salesforce.
 *
 * Capabilities:
 *   - All sf_* custom tools (query, create, update, upsert, describe,
 *     chatter) dispatched by our server
 *   - agent_toolset_20260401 which gives the agent web search + a
 *     sandboxed computer to enrich records (pull company info, news)
 *   - Rich artifact output: when the user asks for a report, the agent
 *     is instructed to emit a React component (JSX) the caller can
 *     promote to an artifact
 *
 * Usage:
 *   const output = await runSalesforceConcierge("Just met Acme Toys, log a ~$200k enterprise opp and enrich the record");
 *
 * Returned text contains the agent's response plus any artifact JSX.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "../config/anthropic";
import { getEnvironmentId } from "./managedAgentSetup";
import {
  SF_TOOL_DEFINITIONS,
  SF_TOOL_NAMES,
  dispatchSalesforceTool,
} from "../tools/salesforce";

const MODEL = "claude-opus-4-7";
// Opus 4.7 does not support speed=fast (only Sonnet / Haiku do).
// Keeping standard speed; latency is managed by the single-call 120s
// long-poll in handleSalesforceConcierge.
const SPEED: "standard" | "fast" = "standard";

const SYSTEM_PROMPT = `
You are the Salesforce concierge for a sales + revenue-ops team.
Be fast, concise, and decisive. A user talks to you in plain English.

Tools:
  • sf_* — SOQL query, create, update, upsert, describe, Chatter (read + post)
  • agent_toolset_20260401 — web search for public info (only when enrichment is needed)

Rules of engagement (important — read carefully):
  1. Plan before you act. Decide the MINIMUM set of tool calls that
     answers the question. Most report questions need ONE aggregate
     SOQL query, not five. Don't double-check yourself.
  2. No redundant queries. Never run the same or near-identical SOQL
     twice in one session.
  3. Only web-search when the ask explicitly needs external info (a new
     company you're logging). Don't web-search for internal reports.
  4. Users never paste Salesforce IDs. If they name a customer, find-
     or-create the Account (sf_query LIKE first, sf_create if missing).
  5. Be decisive. No clarifying questions unless the ambiguity really
     blocks the work.

Output format:
  • For report questions (pipeline, closed deals, slipping deals, etc.):
    Lead with a 1-2 sentence headline, then a compact table or bullet
    list of the key numbers. Optionally append a short '### Visual
    Artifact' block with a default-exported React component (Tailwind,
    under 100 lines, simple styled divs — no chart libs). Skip the
    artifact for trivial asks with fewer than 3 data points.
  • For mutating actions (log a deal, update a record): report what you
    did in 3-4 sentences tops. Include the record Name but not its Id
    unless asked.
  • For enrichment + log: pull the public facts in one or two web
    searches, create/update the records, post a Chatter summary, and
    reply with a short confirmation plus 3 talking points.

Never narrate your steps mid-session. Just do the work and report the
result at the end.
`.trim();

interface ConciergeCall {
  request: string;
  // Optional: prior conversation turns for multi-turn support (future)
}

// ── In-memory session registry for async polling ─────────────────────

type ConciergeStatus = "running" | "completed" | "failed";

interface ConciergeState {
  request: string;
  status: ConciergeStatus;
  text: string; // latest accumulated text (even mid-run)
  toolCalls: string[]; // human-readable trail of tools invoked
  sessionId: string;
  agentId: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

const conciergeSessions = new Map<string, ConciergeState>();
const MAX_SESSIONS_RETAINED = 100;

// Cached managed agent — the concierge config is static, so we create it
// once per process and reuse it across all calls. Saves 1-3 seconds per
// invocation vs. creating a fresh agent every time.
let cachedAgentId: string | null = null;
let agentPromise: Promise<string> | null = null;

async function getOrCreateConciergeAgent(): Promise<string> {
  if (cachedAgentId) return cachedAgentId;
  if (agentPromise) return agentPromise;

  const tools: Anthropic.Beta.Agents.AgentCreateParams["tools"] = [
    { type: "agent_toolset_20260401" },
    ...(SF_TOOL_DEFINITIONS as unknown as NonNullable<
      Anthropic.Beta.Agents.AgentCreateParams["tools"]
    >),
  ];

  agentPromise = (async () => {
    const modelField =
      SPEED === "fast"
        ? ({ id: MODEL, speed: SPEED } as unknown as Anthropic.Beta.Agents.AgentCreateParams["model"])
        : (MODEL as Anthropic.Beta.Agents.AgentCreateParams["model"]);
    const agent = await anthropic.beta.agents.create({
      name: "Salesforce concierge",
      model: modelField,
      system: SYSTEM_PROMPT,
      tools,
    });
    cachedAgentId = agent.id;
    console.log(
      `[concierge] cached agent ${agent.id} (${MODEL}, speed=${SPEED})`
    );
    return agent.id;
  })();

  try {
    return await agentPromise;
  } catch (err) {
    agentPromise = null;
    throw err;
  }
}

function rememberState(state: ConciergeState): void {
  conciergeSessions.set(state.sessionId, state);
  // Simple LRU-ish cap
  if (conciergeSessions.size > MAX_SESSIONS_RETAINED) {
    const first = conciergeSessions.keys().next().value;
    if (first) conciergeSessions.delete(first);
  }
}

export function getConciergeStatus(
  sessionId: string
): ConciergeState | undefined {
  return conciergeSessions.get(sessionId);
}

/**
 * Start a concierge session in the background. Returns immediately with
 * the sessionId; the caller can poll getConciergeStatus(sessionId) to
 * check progress and grab the final text once status === "completed".
 */
export async function startSalesforceConciergeAsync(
  call: ConciergeCall
): Promise<{ sessionId: string; agentId: string }> {
  const [agentId, environmentId] = await Promise.all([
    getOrCreateConciergeAgent(),
    getEnvironmentId(),
  ]);

  const session = await anthropic.beta.sessions.create({
    agent: agentId,
    environment_id: environmentId,
    title: `Concierge: ${call.request.slice(0, 80)}`,
  });

  const state: ConciergeState = {
    request: call.request,
    status: "running",
    text: "",
    toolCalls: [],
    sessionId: session.id,
    agentId,
    startedAt: new Date().toISOString(),
  };
  rememberState(state);

  console.log(
    `[concierge] async session=${session.id} agent=${agentId} request="${call.request.slice(0, 120)}"`
  );

  // Fire-and-forget — stream events into `state` in the background
  streamConciergeSession(state, call.request).catch((err) => {
    state.status = "failed";
    state.error = err instanceof Error ? err.message : String(err);
    state.completedAt = new Date().toISOString();
    console.error(`[concierge] session ${session.id} failed:`, err);
  });

  return { sessionId: session.id, agentId };
}

async function streamConciergeSession(
  state: ConciergeState,
  userMessage: string
): Promise<void> {
  const stream = await anthropic.beta.sessions.events.stream(state.sessionId);
  await anthropic.beta.sessions.events.send(state.sessionId, {
    events: [
      {
        type: "user.message",
        content: [{ type: "text", text: userMessage }],
      },
    ],
  });

  const pendingToolCalls: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }> = [];

  for await (const event of stream) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = event as any;
    switch (e.type) {
      case "agent.message":
        for (const block of e.content ?? []) {
          if (block.type === "text") state.text += block.text;
        }
        break;

      case "agent.custom_tool_use":
        state.toolCalls.push(e.name);
        pendingToolCalls.push({
          id: e.id,
          name: e.name,
          input: (e.input ?? {}) as Record<string, unknown>,
        });
        break;

      case "session.status_idle": {
        const reason = e.stop_reason?.type;
        if (reason === "end_turn") {
          state.status = "completed";
          state.completedAt = new Date().toISOString();
          return;
        }
        if (reason === "retries_exhausted") {
          state.status = "failed";
          state.error = "Session exhausted retries";
          state.completedAt = new Date().toISOString();
          return;
        }
        if (reason === "requires_action" && pendingToolCalls.length > 0) {
          const results = await Promise.all(
            pendingToolCalls.map(async (tc) => {
              const result = SF_TOOL_NAMES.has(tc.name)
                ? await dispatchSalesforceTool(tc.name, tc.input)
                : `Error: unknown tool "${tc.name}"`;
              return { tc, result };
            })
          );
          await anthropic.beta.sessions.events.send(state.sessionId, {
            events: results.map(({ tc, result }) => ({
              type: "user.custom_tool_result" as const,
              custom_tool_use_id: tc.id,
              content: [{ type: "text" as const, text: result }],
            })),
          });
          pendingToolCalls.length = 0;
        }
        break;
      }

      case "session.error":
        state.status = "failed";
        state.error = e.error?.message ?? "session error";
        state.completedAt = new Date().toISOString();
        return;

      case "session.status_terminated":
        state.status = state.text ? "completed" : "failed";
        state.error = state.text ? undefined : "session terminated";
        state.completedAt = new Date().toISOString();
        return;

      default:
        break;
    }
  }

  // Stream closed without explicit end_turn — treat as terminated
  if (state.status === "running") {
    state.status = "completed";
    state.completedAt = new Date().toISOString();
  }
}

/**
 * Run a single concierge session to completion, returning the agent's
 * final text output. Blocking — use only for admin/testing paths; the
 * MCP tool uses startSalesforceConciergeAsync + getConciergeStatus.
 */
export async function runSalesforceConcierge(
  call: ConciergeCall
): Promise<{ text: string; sessionId: string; agentId: string }> {
  const tools: Anthropic.Beta.Agents.AgentCreateParams["tools"] = [
    { type: "agent_toolset_20260401" },
    ...(SF_TOOL_DEFINITIONS as unknown as NonNullable<
      Anthropic.Beta.Agents.AgentCreateParams["tools"]
    >),
  ];

  // Create a fresh agent per call for simplicity. In steady state we'd
  // cache by config hash like agentRegistry does.
  const agent = await anthropic.beta.agents.create({
    name: "Salesforce concierge",
    model: MODEL,
    system: SYSTEM_PROMPT,
    tools,
  });

  const environmentId = await getEnvironmentId();
  const session = await anthropic.beta.sessions.create({
    agent: agent.id,
    environment_id: environmentId,
    title: `Concierge: ${call.request.slice(0, 80)}`,
  });

  console.log(
    `[concierge] session=${session.id} agent=${agent.id} request="${call.request.slice(0, 120)}"`
  );

  const stream = await anthropic.beta.sessions.events.stream(session.id);
  await anthropic.beta.sessions.events.send(session.id, {
    events: [
      {
        type: "user.message",
        content: [{ type: "text", text: call.request }],
      },
    ],
  });

  let responseText = "";
  const pendingToolCalls: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }> = [];

  for await (const event of stream) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = event as any;
    switch (e.type) {
      case "agent.message":
        for (const block of e.content ?? []) {
          if (block.type === "text") responseText += block.text;
        }
        break;

      case "agent.custom_tool_use":
        pendingToolCalls.push({
          id: e.id,
          name: e.name,
          input: (e.input ?? {}) as Record<string, unknown>,
        });
        break;

      case "session.status_idle": {
        const reason = e.stop_reason?.type;
        if (reason === "end_turn") {
          return {
            text: responseText,
            sessionId: session.id,
            agentId: agent.id,
          };
        }
        if (reason === "retries_exhausted") {
          throw new Error(`Concierge session ${session.id} exhausted retries`);
        }
        if (reason === "requires_action" && pendingToolCalls.length > 0) {
          const results = await Promise.all(
            pendingToolCalls.map(async (tc) => {
              const result = SF_TOOL_NAMES.has(tc.name)
                ? await dispatchSalesforceTool(tc.name, tc.input)
                : `Error: unknown tool "${tc.name}"`;
              return { tc, result };
            })
          );
          await anthropic.beta.sessions.events.send(session.id, {
            events: results.map(({ tc, result }) => ({
              type: "user.custom_tool_result" as const,
              custom_tool_use_id: tc.id,
              content: [{ type: "text" as const, text: result }],
            })),
          });
          pendingToolCalls.length = 0;
        }
        break;
      }

      case "session.error":
        throw new Error(
          `Concierge session error: ${e.error?.message ?? "unknown"}`
        );

      case "session.status_terminated":
        return {
          text: responseText || "(session terminated without response)",
          sessionId: session.id,
          agentId: agent.id,
        };

      default:
        break;
    }
  }

  return { text: responseText, sessionId: session.id, agentId: agent.id };
}
