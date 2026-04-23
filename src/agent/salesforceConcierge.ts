/**
 * Salesforce Concierge — thin wrapper that kicks off the wf-concierge
 * workflow via the standard executor. No separate execution path, no
 * in-memory session registry — every concierge call is a real
 * WorkflowRun visible in Run History and governed like any other flow.
 *
 * The workflow itself is defined in:
 *   src/workflow/fixtures/salesforceConcierge.json
 *
 * It runs as:
 *   input (request) → agent (with sf_* tools + agent_toolset_20260401) → finalize
 */
import prisma from "../db/client";
import type { WorkflowSchema } from "../workflow/types";
import { validateWorkflowSchema } from "../workflow/schemaValidator";
import { executeWorkflow } from "../workflow/executor";
import { createWorkflowRun, updateRunStatus } from "../workflow/persistence";

const CONCIERGE_WORKFLOW_ID = "wf-concierge";

export interface ConciergeResult {
  runId: string;
  status: "completed" | "failed" | "running";
  text: string;
  error?: string;
}

/**
 * Start the concierge workflow. Returns the runId as soon as the run is
 * registered and the executor is kicked off. Poll pollConciergeResult
 * for completion / output.
 */
export async function startConciergeRun(request: string): Promise<{ runId: string }> {
  const workflow = await prisma.workflow.findUnique({
    where: { id: CONCIERGE_WORKFLOW_ID },
  });
  if (!workflow) {
    throw new Error(
      `Concierge workflow '${CONCIERGE_WORKFLOW_ID}' not found. Seed it from src/workflow/fixtures/salesforceConcierge.json.`
    );
  }

  const schema = JSON.parse(workflow.schemaJson) as WorkflowSchema;
  const validation = validateWorkflowSchema(schema);
  if (!validation.valid) {
    throw new Error(
      `Concierge workflow schema is invalid: ${validation.errors.join(", ")}`
    );
  }

  const input = { request };
  const runId = await createWorkflowRun(CONCIERGE_WORKFLOW_ID, input);

  // Fire-and-forget — same pattern as POST /api/runs
  executeWorkflow(runId, schema, input).catch(async (err) => {
    console.error(`[concierge] run ${runId} failed:`, err);
    try {
      await updateRunStatus(runId, "failed");
    } catch (persistErr) {
      console.error(`[concierge] failed to mark ${runId} failed:`, persistErr);
    }
  });

  console.log(
    `[concierge] started run=${runId} request="${request.slice(0, 120)}"`
  );
  return { runId };
}

/**
 * Read the current state of a concierge run. Returns the final text
 * output once status === 'completed'.
 */
export async function pollConciergeResult(
  runId: string
): Promise<ConciergeResult> {
  const run = await prisma.workflowRun.findUnique({
    where: { id: runId },
    include: {
      steps: {
        orderBy: { startedAt: "asc" },
      },
    },
  });
  if (!run) {
    return {
      runId,
      status: "failed",
      text: "",
      error: `Run ${runId} not found`,
    };
  }

  // The concierge step is the one named 'concierge'. Its output_json
  // carries the agent's returned text.
  const conciergeStep = run.steps.find((s) => s.nodeId === "concierge");

  let text = "";
  if (conciergeStep?.outputJson) {
    try {
      const out = JSON.parse(conciergeStep.outputJson);
      if (typeof out?.text === "string") text = out.text;
      else text = JSON.stringify(out);
    } catch {
      text = conciergeStep.outputJson;
    }
  }

  if (run.status === "completed") {
    return { runId, status: "completed", text };
  }
  if (run.status === "failed") {
    return {
      runId,
      status: "failed",
      text,
      error: conciergeStep?.errorMessage ?? "Run failed",
    };
  }
  return { runId, status: "running", text };
}
