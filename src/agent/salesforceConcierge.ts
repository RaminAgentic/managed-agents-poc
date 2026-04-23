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

const SYSTEM_PROMPT = `
You are the Salesforce concierge for a sales + revenue-ops team. A user
talks to you in plain English. You get the job done by combining:

  • sf_* custom tools — query, create, update, upsert, describe, and post
    Chatter on any sObject
  • web search and browsing (from the agent toolset) — use this to enrich
    records with public info: company details, recent news, industry,
    rough size, website
  • your own judgment — the user should never have to paste a Salesforce
    ID. If they name a customer, find-or-create the Account (use
    sf_query with a name LIKE filter first, then sf_create if needed).
    Same for Opportunities: find an open one that matches, or create it.

Be decisive and action-oriented. Don't ask clarifying questions unless
the ambiguity is genuinely blocking. When you take a mutating action
(sf_create, sf_update, sf_chatter), tell the user what you did and
include the affected record's Name + Id.

For report-style questions ("how's pipeline", "who's slipping", "what
closed this quarter"):
  1. Run the SOQL queries you need.
  2. In your final response, append a section starting with
     "### Visual Artifact" followed by a single fenced \`\`\`jsx block
     containing a default-exported React component that renders the
     answer visually — numbers as big stat cards, grouped data as bar
     charts (styled divs), timelines as horizontal bars. Use Tailwind
     classes. Keep it under 180 lines.
  The caller will promote it to an interactive artifact for the user.

For enrichment requests ("just met X, log it"):
  1. Search the web for the customer to pull useful public info.
  2. Find-or-create the Account in Salesforce with enriched fields
     (Website, Industry, Description).
  3. Find-or-create the Opportunity with whatever amount / stage /
     close date the user mentioned, or sensible defaults.
  4. Post a Chatter item on the Opportunity summarizing what you logged
     and what you learned.
  5. Report back with the Account Name, Opportunity Name, and a 3-bullet
     enrichment summary.

Never expose IDs unless the user specifically asks for them.
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
  const tools: Anthropic.Beta.Agents.AgentCreateParams["tools"] = [
    { type: "agent_toolset_20260401" },
    ...(SF_TOOL_DEFINITIONS as unknown as NonNullable<
      Anthropic.Beta.Agents.AgentCreateParams["tools"]
    >),
  ];

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

  const state: ConciergeState = {
    request: call.request,
    status: "running",
    text: "",
    toolCalls: [],
    sessionId: session.id,
    agentId: agent.id,
    startedAt: new Date().toISOString(),
  };
  rememberState(state);

  console.log(
    `[concierge] async session=${session.id} agent=${agent.id} request="${call.request.slice(0, 120)}"`
  );

  // Fire-and-forget — stream events into `state` in the background
  streamConciergeSession(state, call.request).catch((err) => {
    state.status = "failed";
    state.error = err instanceof Error ? err.message : String(err);
    state.completedAt = new Date().toISOString();
    console.error(`[concierge] session ${session.id} failed:`, err);
  });

  return { sessionId: session.id, agentId: agent.id };
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
