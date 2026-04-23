/**
 * Agent Node Handler (Managed Agents edition)
 *
 * Executes a workflow agent node as a Managed Agents session.
 *
 * Responsibilities:
 * 1. Resolve inputMapping values from the run context
 * 2. Substitute {{variable}} placeholders in the instruction template
 *    (only used to compute the *resolved* identity sent to the registry)
 * 3. Resolve (or create) the Anthropic agent via agentRegistry — this is
 *    the versioned, audited side of things
 * 4. Create a fresh session on the shared environment
 * 5. Stream session events until end_turn; collect the agent's text output
 * 6. Persist agentSessionId + agentId on the RunStep
 * 7. Return the collected text (and optional parsed JSON) as step outputs
 *
 * MCP tool calls and Anthropic-authored skills are dispatched server-side
 * by Anthropic — we don't handle them locally.
 */
import { anthropic } from "../../config/anthropic";
import type {
  WorkflowNode,
  RunContext,
  HandlerOptions,
  StepResult,
  AgentNodeConfig,
} from "../types";
import { resolveInputMapping, substituteTemplate } from "../resolveInputMapping";
import { setStepAgentSession, setStepAgent } from "../persistence";
import { findOrCreateAgent } from "../agentRegistry";
import { getEnvironmentId } from "../../agent/managedAgentSetup";
import {
  SF_TOOL_NAMES,
  dispatchSalesforceTool,
} from "../../tools/salesforce";
import {
  FLOW_BUILDER_TOOL_NAMES,
  dispatchFlowBuilderTool,
} from "../../tools/flowBuilder";

const DEFAULT_TIMEOUT_SECONDS = 300;
const DEFAULT_MODEL = "claude-opus-4-7";

export async function runAgentNode(
  node: WorkflowNode,
  ctx: RunContext,
  opts: HandlerOptions
): Promise<StepResult> {
  const config = node.config as AgentNodeConfig;
  const timeoutSeconds = config.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;

  console.log(
    `[agentNodeHandler] Node "${node.id}" — timeout: ${timeoutSeconds}s`
  );

  // Step 1: resolve input mapping values
  const resolvedInputs = config.inputMapping
    ? resolveInputMapping(config.inputMapping, ctx)
    : {};

  console.log(
    `[agentNodeHandler] Resolved inputs:`,
    Object.keys(resolvedInputs)
  );

  // Step 2: substitute placeholders in the instruction template
  //
  // The *substituted* system prompt is what defines the agent's identity.
  // If the template vars resolve to different values across runs, the
  // config hash will differ and you'll get a new agent version. That's
  // usually NOT what we want — instructions should be templatic, not
  // input-dependent — so for registry purposes we pass the raw (un-
  // substituted) instructions. The resolved inputs are sent as the user
  // message instead.
  const rawInstructions = config.instructions ?? "You are a helpful assistant.";

  // Step 3: find or create the managed agent (versioned in our DB)
  const resolved = await findOrCreateAgent({
    workflowId: ctx.workflowId,
    nodeId: node.id,
    nodeName: node.name || node.id,
    config: { ...config, instructions: rawInstructions },
    modelConfig: node.modelConfig,
  });

  console.log(
    `[agentNodeHandler] Agent v${resolved.version} (db=${resolved.id}, anthropic=${resolved.anthropicAgentId})`
  );

  await setStepAgent(opts.stepId, resolved.id);

  // Step 4: create a session on the shared environment
  const environmentId = await getEnvironmentId();

  // Build the user message — either the resolved inputs as JSON context,
  // or a default nudge if there's nothing to pass.
  const userPrompt =
    Object.keys(resolvedInputs).length > 0
      ? `Context for this task:\n\n${JSON.stringify(resolvedInputs, null, 2)}`
      : "Please proceed with the task described in your instructions.";

  // Allow the instructions to also be substituted (so `{{var}}` still works
  // for dynamic prompt injection) — this string is sent as the user message
  // prefix, which lets per-run values influence the agent without creating
  // a new agent version.
  const substituted = substituteTemplate(rawInstructions, resolvedInputs);
  const templateNote =
    substituted !== rawInstructions
      ? `\n\nResolved instructions for this run:\n${substituted}`
      : "";

  const session = await anthropic.beta.sessions.create({
    agent: resolved.anthropicAgentId,
    environment_id: environmentId,
    title: `${node.name || node.id} — run ${ctx.run.id.slice(0, 8)}`,
  });

  await setStepAgentSession(opts.stepId, session.id);

  console.log(
    `[agentNodeHandler] Session ${session.id} created (agent=${resolved.anthropicAgentId}, env=${environmentId})`
  );

  // Step 5: stream events
  const runPromise = runSession({
    sessionId: session.id,
    userMessage: userPrompt + templateNote,
  });

  const timeoutMs = timeoutSeconds * 1000;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    setTimeout(
      () =>
        reject(
          new Error(
            `Agent node "${node.id}" timed out after ${timeoutSeconds}s`
          )
        ),
      timeoutMs
    );
  });

  const textContent = await Promise.race([runPromise, timeoutPromise]);

  // Step 6: parse output
  const outputs: Record<string, unknown> = { text: textContent };

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

/**
 * Stream a managed-agent session from first send to end_turn.
 * Returns the concatenated text output from all agent.message events.
 */
async function runSession(params: {
  sessionId: string;
  userMessage: string;
}): Promise<string> {
  const { sessionId, userMessage } = params;

  const stream = await anthropic.beta.sessions.events.stream(sessionId);

  await anthropic.beta.sessions.events.send(sessionId, {
    events: [
      {
        type: "user.message",
        content: [{ type: "text", text: userMessage }],
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
          if (block.type === "text") {
            responseText += block.text;
          }
        }
        break;

      case "agent.custom_tool_use":
        console.log(
          `[agentNodeHandler] custom_tool_use: ${e.name} ${JSON.stringify(
            e.input
          ).slice(0, 200)}`
        );
        pendingToolCalls.push({
          id: e.id,
          name: e.name,
          input: (e.input ?? {}) as Record<string, unknown>,
        });
        break;

      case "session.status_idle": {
        const reason = e.stop_reason?.type;
        if (reason === "end_turn") {
          return responseText;
        }
        if (reason === "retries_exhausted") {
          throw new Error(
            `Managed agent session ${sessionId} exhausted retries`
          );
        }
        if (reason === "requires_action") {
          if (pendingToolCalls.length === 0) {
            console.warn(
              `[agentNodeHandler] Session ${sessionId} requires_action but no tool calls queued — unexpected`
            );
            break;
          }

          // Dispatch every queued custom tool in parallel
          const results = await Promise.all(
            pendingToolCalls.map(async (tc) => {
              let result: string;
              if (SF_TOOL_NAMES.has(tc.name)) {
                result = await dispatchSalesforceTool(tc.name, tc.input);
              } else if (FLOW_BUILDER_TOOL_NAMES.has(tc.name)) {
                result = await dispatchFlowBuilderTool(tc.name, tc.input);
              } else {
                result = `Error: no handler registered for custom tool "${tc.name}"`;
              }
              return { tc, result };
            })
          );

          const events = results.map(({ tc, result }) => ({
            type: "user.custom_tool_result" as const,
            custom_tool_use_id: tc.id,
            content: [{ type: "text" as const, text: result }],
          }));

          await anthropic.beta.sessions.events.send(sessionId, { events });
          pendingToolCalls.length = 0;
        }
        break;
      }

      case "session.error":
        throw new Error(
          `Managed agent session error: ${e.error?.message ?? "unknown"}`
        );

      case "session.status_terminated":
        return responseText || "(session terminated without response)";

      default:
        break;
    }
  }

  return responseText;
}
