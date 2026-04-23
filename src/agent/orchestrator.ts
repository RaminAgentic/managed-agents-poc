/**
 * Chat orchestrator → Flow Builder.
 *
 * The Chat tab is a natural-language entrypoint for creating new
 * workflows. It delegates every prompt to the `wf-flow-builder`
 * workflow, which generates + publishes a real WorkflowSchema into
 * the DB (immediately visible via MCP and the flow editor).
 *
 * Runs go through the standard executor — full Run History audit
 * trail, same governance as any other flow.
 */
import prisma from "../db/client";
import type { WorkflowSchema } from "../workflow/types";
import { validateWorkflowSchema } from "../workflow/schemaValidator";
import { executeWorkflow } from "../workflow/executor";
import { createWorkflowRun, updateRunStatus } from "../workflow/persistence";

const FLOW_BUILDER_WORKFLOW_ID = "wf-flow-builder";
const POLL_INTERVAL_MS = 2_000;
const MAX_WAIT_MS = 240_000; // 4 min cap — flow builder typically finishes in < 60s

/** Routing label returned to the Chat UI. Kept for backward compat. */
export type AgentType = "weather" | "research" | "other";

export interface OrchestratorResult {
  response: string;
  agentType: AgentType;
  runId?: string;
}

export async function runOrchestrator(
  userPrompt: string
): Promise<OrchestratorResult> {
  if (!userPrompt.trim()) {
    throw new Error("Empty prompt — nothing to build.");
  }

  const workflow = await prisma.workflow.findUnique({
    where: { id: FLOW_BUILDER_WORKFLOW_ID },
  });
  if (!workflow) {
    throw new Error(
      `Flow Builder workflow '${FLOW_BUILDER_WORKFLOW_ID}' not found. Run 'npm run seed:demos' to install it.`
    );
  }

  const schema = JSON.parse(workflow.schemaJson) as WorkflowSchema;
  const validation = validateWorkflowSchema(schema);
  if (!validation.valid) {
    throw new Error(
      `Flow Builder schema invalid: ${validation.errors.join(", ")}`
    );
  }

  const input = { description: userPrompt };
  const runId = await createWorkflowRun(FLOW_BUILDER_WORKFLOW_ID, input);

  executeWorkflow(runId, schema, input).catch(async (err) => {
    console.error(`[orchestrator] flow-builder run ${runId} failed:`, err);
    try {
      await updateRunStatus(runId, "failed");
    } catch (persistErr) {
      console.error(`[orchestrator] failed to mark ${runId} failed:`, persistErr);
    }
  });

  console.log(
    `[orchestrator] flow-builder run=${runId} prompt="${userPrompt.slice(0, 120)}"`
  );

  const started = Date.now();
  while (Date.now() - started < MAX_WAIT_MS) {
    const run = await prisma.workflowRun.findUnique({
      where: { id: runId },
      include: { steps: { orderBy: { startedAt: "asc" } } },
    });
    if (!run) {
      throw new Error(`Run ${runId} vanished`);
    }

    if (run.status === "completed" || run.status === "failed") {
      const builderStep = run.steps.find((s) => s.nodeId === "builder");
      let text = "";
      if (builderStep?.outputJson) {
        try {
          const out = JSON.parse(builderStep.outputJson);
          text = typeof out?.text === "string" ? out.text : JSON.stringify(out);
        } catch {
          text = builderStep.outputJson;
        }
      }
      if (run.status === "failed") {
        const msg = builderStep?.errorMessage ?? "Flow builder failed";
        return {
          response: text ? `${msg}\n\n${text}` : msg,
          agentType: "other",
          runId,
        };
      }
      return { response: text, agentType: "other", runId };
    }

    await sleep(POLL_INTERVAL_MS);
  }

  return {
    response:
      `Flow builder is still running. Run ID: ${runId}. Check Run History for the result.`,
    agentType: "other",
    runId,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
