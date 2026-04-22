/**
 * Finalize Node Handler
 *
 * Marks the run as completed and produces a summary of all step outputs.
 * This is the terminal node in a workflow graph.
 *
 * No external API calls — just aggregation and status update.
 */
import type {
  WorkflowNode,
  RunContext,
  HandlerOptions,
  StepResult,
} from "../types";
import { updateRunStatus, logEvent } from "../persistence";

export async function runFinalizeNode(
  node: WorkflowNode,
  ctx: RunContext,
  opts: HandlerOptions
): Promise<StepResult> {
  // Aggregate all step outputs into a summary
  const summary: Record<string, unknown> = {};
  for (const [stepNodeId, stepResult] of Object.entries(ctx.steps)) {
    summary[stepNodeId] = stepResult.outputs;
  }

  // Mark the run as completed
  await updateRunStatus(opts.runId, "completed");

  // Log the workflow_completed event with full summary
  await logEvent(opts.runId, opts.stepId, "workflow_completed", { summary });

  return {
    outputs: summary,
  };
}
