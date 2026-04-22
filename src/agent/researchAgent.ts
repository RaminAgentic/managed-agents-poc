import { anthropic } from "../config/anthropic";
import { getResearchAgentId, getEnvironmentId } from "./managedAgentSetup";

/**
 * Research agent via the Managed Agents API.
 *
 * No custom tools — just sends a topic, streams events, and returns the
 * agent's text response. Used by the orchestrator for knowledge / research
 * tasks.
 */
export async function runResearchAgent(topic: string): Promise<string> {
  // Lazily create / reuse agent + environment
  const [agentId, envId] = await Promise.all([
    getResearchAgentId(),
    getEnvironmentId(),
  ]);

  // Each user message gets a fresh session
  const session = await anthropic.beta.sessions.create({
    agent: agentId,
    environment_id: envId,
    title: `Research: ${topic.slice(0, 60)}`,
  });

  console.log(`\n━━━ Research session created ━━━`);
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
        content: [{ type: "text", text: topic }],
      },
    ],
  });

  console.log(`→ Sent research topic to session ${session.id}`);

  // ── Process stream events ────────────────────────────────────────
  let responseText = "";

  for await (const event of stream) {
    switch (event.type) {
      case "session.status_running":
        console.log("  [research session running]");
        break;

      case "session.status_rescheduled":
        console.log("  [research session rescheduled]");
        break;

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

      case "agent.tool_use":
        console.log(`  [agent.tool_use] ${event.name}`);
        break;

      case "agent.tool_result":
        console.log(`  [agent.tool_result] tool_use_id=${event.tool_use_id}`);
        break;

      case "session.status_idle": {
        const reason = event.stop_reason;

        if (reason.type === "end_turn") {
          console.log("  [research session idle — end_turn]");
          console.log(
            `\n━━━ Research answer ━━━\n${responseText}\n━━━━━━━━━━━━━━━━━━━━`
          );
          return responseText;
        }

        if (reason.type === "retries_exhausted") {
          console.error("  [research session — retries_exhausted]");
          throw new Error("Research agent retries exhausted.");
        }

        // requires_action shouldn't happen (no custom tools) — log and continue
        console.log(`  [research session idle — ${reason.type}]`);
        break;
      }

      case "session.error":
        console.error("  [session.error]", event.error);
        throw new Error(
          `Research session error: ${event.error.message}`
        );

      case "session.status_terminated":
        console.log("  [research session terminated]");
        return responseText || "Research session terminated unexpectedly.";

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

  return responseText || "No response from research agent.";
}
