/**
 * Subflow node (v2): invokes another workflow as a step.
 *
 * When `waitForCompletion` (default true):
 *   - Creates a child WorkflowRun with parentRunId = this run
 *   - Executes the child synchronously
 *   - Returns the child's finalize outputs as this node's outputs
 *
 * When `waitForCompletion = false`:
 *   - Creates + kicks off the child run, returns { childRunId } immediately
 *
 * Propagation: a failed child fails this step, unless `propagateFailure`
 * is explicitly set to false.
 */
import prisma from "../../db/client";
import type {
  WorkflowNode,
  RunContext,
  HandlerOptions,
  StepResult,
  SubflowNodeConfig,
  WorkflowSchema,
} from "../types";
import { resolveInputMapping } from "../resolveInputMapping";
import { createWorkflowRun, updateRunStatus } from "../persistence";
import { validateWorkflowSchema } from "../schemaValidator";
import { executeWorkflow } from "../executor";

export async function runSubflowNode(
  node: WorkflowNode,
  ctx: RunContext,
  _opts: HandlerOptions
): Promise<StepResult> {
  const config = node.config as SubflowNodeConfig;
  if (!config.workflowId) {
    throw new Error(`Subflow node '${node.id}' missing config.workflowId`);
  }

  const wait = config.waitForCompletion !== false; // default true
  const propagate = config.propagateFailure !== false; // default true

  const childInput = config.inputMapping
    ? resolveInputMapping(config.inputMapping, ctx)
    : {};

  const childWorkflow = await prisma.workflow.findUnique({
    where: { id: config.workflowId },
  });
  if (!childWorkflow) {
    throw new Error(
      `Subflow target workflow '${config.workflowId}' not found`
    );
  }

  const childSchema = JSON.parse(childWorkflow.schemaJson) as WorkflowSchema;
  const validation = validateWorkflowSchema(childSchema);
  if (!validation.valid) {
    throw new Error(
      `Subflow target '${config.workflowId}' schema invalid: ${validation.errors.join(", ")}`
    );
  }

  const childRunId = await createWorkflowRun(config.workflowId, childInput, {
    parentRunId: ctx.run.id,
  });

  console.log(
    `[subflow] ${node.id} → child run ${childRunId} (wait=${wait}, workflow=${config.workflowId})`
  );

  if (!wait) {
    executeWorkflow(childRunId, childSchema, childInput).catch(async (err) => {
      console.error(`[subflow] fire-and-forget child ${childRunId} failed:`, err);
      try {
        await updateRunStatus(childRunId, "failed");
      } catch {
        /* swallow */
      }
    });
    return { outputs: { childRunId, waited: false } };
  }

  try {
    await executeWorkflow(childRunId, childSchema, childInput);
  } catch (err) {
    if (propagate) throw err;
    return {
      outputs: {
        childRunId,
        failed: true,
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }

  const child = await prisma.workflowRun.findUnique({
    where: { id: childRunId },
    include: { steps: { orderBy: { startedAt: "asc" } } },
  });
  if (!child) {
    throw new Error(`Child run ${childRunId} vanished after execution`);
  }

  if (child.status === "failed" && propagate) {
    const failedStep = child.steps.find((s) => s.status === "failed");
    throw new Error(
      `Subflow ${config.workflowId} failed at step '${failedStep?.nodeId ?? "?"}': ${failedStep?.errorMessage ?? "(no message)"}`
    );
  }

  // Harvest the finalize step's outputs (if any) as this step's outputs.
  const finalizeNodeId = childSchema.nodes.find((n) => n.type === "finalize")?.id;
  const finalizeStep = finalizeNodeId
    ? child.steps.find(
        (s) => s.status === "completed" && s.nodeId === finalizeNodeId
      )
    : undefined;
  let childOutputs: Record<string, unknown> = {};
  if (finalizeStep?.outputJson) {
    try {
      childOutputs = JSON.parse(finalizeStep.outputJson);
    } catch {
      childOutputs = { raw: finalizeStep.outputJson };
    }
  }

  return {
    outputs: {
      childRunId,
      childStatus: child.status,
      ...childOutputs,
    },
  };
}
