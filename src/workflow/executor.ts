/**
 * Workflow Executor — the core graph walker.
 *
 * Walks a WorkflowSchema graph from the entry node to completion.
 * At each step:
 *   1. Find the current node in the schema
 *   2. Create a RunStep record (status = running)
 *   3. Execute the node's handler
 *   4. Store outputs in the runtime context
 *   5. Complete the RunStep record
 *   6. Find the next node via edges
 *   7. Repeat until finalize or no next edge
 *
 * Error handling: on any throw, the current step and the entire run
 * are marked as failed with full error details logged as events.
 *
 * Design choices:
 * - Explicit while-loop (not recursion) — flat stack, easy debugging.
 * - maxSteps guard (default 50) prevents infinite loops from cyclic edges.
 * - Context is a plain in-memory object — no proxies, no reactivity.
 * - All persistence calls are now async (Prisma v2 migration).
 */
import type { WorkflowSchema, WorkflowNode, RunContext } from "./types";
import { getNodeHandler } from "./nodeHandlers";
import {
  createRunStep,
  completeRunStep,
  failRunStep,
  logEvent,
  updateRunStatus,
} from "./persistence";

const MAX_STEPS = 50;

/**
 * Find the next node ID by following edges from the current node.
 *
 * v1: takes the first matching edge (no conditional routing).
 * TODO: support edge.condition for branching workflows.
 */
function resolveNextNode(
  schema: WorkflowSchema,
  currentNodeId: string
): string | null {
  const edge = schema.edges.find((e) => e.source === currentNodeId);
  return edge ? edge.target : null;
}

/**
 * Look up a node in the schema by ID.
 */
function findNode(
  schema: WorkflowSchema,
  nodeId: string
): WorkflowNode | undefined {
  return schema.nodes.find((n) => n.id === nodeId);
}

/**
 * Execute a workflow from start to finish.
 *
 * This function is designed to be called in a fire-and-forget pattern
 * from the API layer. It manages its own error handling and persistence —
 * the caller only needs to catch truly unexpected errors (process-level).
 *
 * @param runId - ID of the WorkflowRun record (already created by the API layer)
 * @param workflowSchema - Parsed workflow definition
 * @param input - User-provided input for this run
 */
export async function executeWorkflow(
  runId: string,
  workflowSchema: WorkflowSchema,
  input: Record<string, unknown>
): Promise<void> {
  // Build the runtime context
  const ctx: RunContext = {
    workflowId: workflowSchema.id,
    run: { id: runId, input },
    steps: {},
  };

  let currentNodeId: string | null = workflowSchema.entryNodeId;
  let stepCount = 0;
  let currentStepId: string | null = null;

  // Mark the run as running
  await updateRunStatus(runId, "running");
  await logEvent(runId, null, "workflow_started", {
    workflowId: workflowSchema.id,
    workflowName: workflowSchema.name,
    entryNode: workflowSchema.entryNodeId,
    inputKeys: Object.keys(input),
  });

  try {
    while (currentNodeId !== null) {
      // Guard against infinite loops
      stepCount++;
      if (stepCount > MAX_STEPS) {
        const msg = `Workflow exceeded max steps (${MAX_STEPS}). Possible cycle in graph.`;
        await logEvent(runId, currentStepId, "max_steps_exceeded", {
          stepCount,
          lastNodeId: currentNodeId,
        });
        throw new Error(msg);
      }

      // Find the current node
      const node = findNode(workflowSchema, currentNodeId);
      if (!node) {
        throw new Error(
          `Node '${currentNodeId}' not found in workflow schema '${workflowSchema.id}'`
        );
      }

      console.log(
        `[executor] Step ${stepCount}: executing node "${node.id}" (type: ${node.type})`
      );

      // Create a RunStep record
      currentStepId = await createRunStep(runId, node.id);
      await logEvent(runId, currentStepId, "step_started", {
        nodeId: node.id,
        nodeType: node.type,
        nodeName: node.name,
      });

      // Get the handler for this node type
      const handler = getNodeHandler(node.type);

      // Execute the handler
      const result = await handler(node, ctx, {
        runId,
        stepId: currentStepId,
      });

      // Store outputs in context for downstream nodes
      ctx.steps[node.id] = result;

      // Persist the completed step
      await completeRunStep(currentStepId, result.outputs);
      await logEvent(runId, currentStepId, "step_completed", {
        nodeId: node.id,
        outputKeys: Object.keys(result.outputs),
      });

      console.log(
        `[executor] Step ${stepCount}: node "${node.id}" completed — outputs: [${Object.keys(
          result.outputs
        ).join(", ")}]`
      );

      // If this was a finalize node, we're done
      // (The finalize handler already marked the run as completed)
      if (node.type === "finalize") {
        console.log(`[executor] Workflow run ${runId} completed successfully.`);
        return;
      }

      // Find the next node
      currentNodeId = resolveNextNode(workflowSchema, currentNodeId);
    }

    // Reached end of graph without a finalize node — still mark as completed
    console.warn(
      `[executor] Workflow run ${runId} ended without a finalize node.`
    );
    await updateRunStatus(runId, "completed");
    await logEvent(runId, null, "workflow_completed", {
      note: "Ended without explicit finalize node",
    });
  } catch (error: unknown) {
    // ── Error handling: fail the step and the run ──
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? (error.stack ?? "") : "";

    console.error(`[executor] Workflow run ${runId} failed:`, message);

    // Fail the current step if one exists
    if (currentStepId) {
      try {
        await failRunStep(currentStepId, error);
      } catch (persistError) {
        console.error("[executor] Failed to persist step failure:", persistError);
      }
    }

    // Mark the run as failed
    try {
      await updateRunStatus(runId, "failed");
      await logEvent(runId, currentStepId, "error", { message, stack });
    } catch (persistError) {
      console.error("[executor] Failed to persist run failure:", persistError);
    }
  }
}
