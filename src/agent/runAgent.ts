import { anthropic } from "../config/anthropic";
import { getWeatherAgentId, getEnvironmentId } from "./managedAgentSetup";
import { dispatchTool } from "./toolDispatcher";

/**
 * Run the weather agent via the Managed Agents API.
 *
 * Creates a new session for each call, opens an SSE event stream, sends the
 * user prompt, and processes streamed events until the agent finishes.
 *
 * Custom tool calls (e.g. get_weather) are dispatched locally:
 *   1. agent.custom_tool_use  → record the pending call
 *   2. session.status_idle (requires_action) → dispatch & send results
 *   3. agent resumes → agent.message → session.status_idle (end_turn)
 */
export async function runAgent(userPrompt: string): Promise<string> {
  // Lazily create / reuse agent + environment
  const [agentId, envId] = await Promise.all([
    getWeatherAgentId(),
    getEnvironmentId(),
  ]);

  // Each user message gets a fresh session
  const session = await anthropic.beta.sessions.create({
    agent: agentId,
    environment_id: envId,
    title: `Weather: ${userPrompt.slice(0, 60)}`,
  });

  console.log(`\n━━━ Session created ━━━`);
  console.log(`  agent_id:       ${agentId}`);
  console.log(`  environment_id: ${envId}`);
  console.log(`  session_id:     ${session.id}`);

  // Open persistent SSE stream
  const stream = await anthropic.beta.sessions.events.stream(session.id);

  // Send the user message into the session
  await anthropic.beta.sessions.events.send(session.id, {
    events: [
      {
        type: "user.message",
        content: [{ type: "text", text: userPrompt }],
      },
    ],
  });

  console.log(`→ Sent user message to session ${session.id}`);

  // ── Process stream events ────────────────────────────────────────
  let responseText = "";
  const pendingToolCalls: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }> = [];

  for await (const event of stream) {
    switch (event.type) {
      // ─ Status bookkeeping ────────────────────────────────────────
      case "session.status_running":
        console.log("  [session running]");
        break;

      case "session.status_rescheduled":
        console.log("  [session rescheduled]");
        break;

      // ─ Agent text output ─────────────────────────────────────────
      case "agent.message":
        for (const block of event.content) {
          if (block.type === "text") {
            responseText += block.text;
          }
        }
        console.log(
          `  [agent.message] ${responseText.slice(0, 120)}${
            responseText.length > 120 ? "…" : ""
          }`
        );
        break;

      // ─ Built-in tool events (handled server-side by the agent) ──
      case "agent.tool_use":
        console.log(`  [agent.tool_use] ${event.name}`);
        break;

      case "agent.tool_result":
        console.log(`  [agent.tool_result] tool_use_id=${event.tool_use_id}`);
        break;

      // ─ Custom tool events (dispatched locally) ───────────────────
      case "agent.custom_tool_use":
        console.log(`  [agent.custom_tool_use] ${event.name}`);
        console.log(`    input: ${JSON.stringify(event.input)}`);
        pendingToolCalls.push({
          id: event.id,
          name: event.name,
          input: event.input as Record<string, unknown>,
        });
        break;

      // ─ Session idle → may need to reply with tool results ────────
      case "session.status_idle": {
        const reason = event.stop_reason;

        if (reason.type === "end_turn") {
          console.log("  [session idle — end_turn]");
          console.log(
            `\n━━━ Final answer ━━━\n${responseText}\n━━━━━━━━━━━━━━━━━━━━`
          );
          return responseText;
        }

        if (reason.type === "requires_action") {
          console.log(
            `  [session idle — requires_action, ${pendingToolCalls.length} tool(s)]`
          );

          // Dispatch each pending custom tool and send results back
          const resultEvents = pendingToolCalls.map((tc) => {
            const result = dispatchTool(tc.name, tc.input);
            console.log(`  ← custom_tool_result (${tc.name}): ${result}`);
            return {
              type: "user.custom_tool_result" as const,
              custom_tool_use_id: tc.id,
              content: [{ type: "text" as const, text: result }],
            };
          });

          await anthropic.beta.sessions.events.send(session.id, {
            events: resultEvents,
          });

          pendingToolCalls.length = 0; // clear
          break;
        }

        if (reason.type === "retries_exhausted") {
          console.error("  [session idle — retries_exhausted]");
          throw new Error("Agent retries exhausted.");
        }

        break;
      }

      // ─ Errors & termination ──────────────────────────────────────
      case "session.error":
        console.error("  [session.error]", event.error);
        throw new Error(
          `Session error: ${event.error.message}`
        );

      case "session.status_terminated":
        console.log("  [session terminated]");
        return responseText || "Session terminated unexpectedly.";

      // ─ Informational events (log only) ───────────────────────────
      case "agent.thinking":
        console.log("  [agent.thinking]");
        break;

      case "span.model_request_start":
        console.log("  [model request start]");
        break;

      case "span.model_request_end":
        console.log(
          `  [model request end] in=${event.model_usage.input_tokens} out=${event.model_usage.output_tokens}`
        );
        break;

      default:
        console.log(`  [${(event as { type: string }).type}]`);
    }
  }

  // Stream ended without an explicit end_turn (shouldn't normally happen)
  return responseText || "No response from agent.";
}
