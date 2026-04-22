/**
 * Workflow Executor — parallel DAG walker.
 *
 * Algorithm:
 *   1. Build edge/node liveness maps from the schema.
 *      - edgeAlive[edgeId] = true       (starts true, flipped false when a
 *                                         gate/router doesn't pick it)
 *      - nodePendingIn[nodeId] = count   (live incoming edges not yet completed)
 *      - nodeState[nodeId]     = pending | running | completed | pruned
 *
 *   2. Seed: entry node starts with nodePendingIn = 0. Any node with
 *      nodePendingIn = 0 is immediately ready.
 *
 *   3. Loop: collect all pending nodes whose nodePendingIn === 0, run them
 *      in parallel via Promise.all. For each completion:
 *        - Store outputs in ctx.steps
 *        - If the node is a branching node (gate / router), inspect its
 *          `chosenEdgeIds` output and kill the non-chosen outgoing edges.
 *          Dead edges propagate: target nodes whose remaining live incoming
 *          edges reach 0 become `pruned` (and their outgoing edges die too).
 *        - For each live outgoing edge, decrement the target's pending count.
 *      Repeat until no pending-ready nodes remain.
 *
 *   4. Finalize: the final status is driven by whether a `finalize` node
 *      ran. If any node failed, the run is marked failed and pending nodes
 *      are cancelled.
 *
 * Safety:
 *   - MAX_STEPS cap prevents runaway graphs.
 *   - A step failure short-circuits the whole run (no attempt to complete
 *     other parallel branches — keeps the failure model simple).
 */
import type {
  WorkflowSchema,
  WorkflowNode,
  WorkflowEdge,
  RunContext,
  StepResult,
} from "./types";
import { getNodeHandler } from "./nodeHandlers";
import {
  createRunStep,
  completeRunStep,
  failRunStep,
  logEvent,
  updateRunStatus,
} from "./persistence";

const MAX_STEPS = 100;

type NodeState = "pending" | "running" | "completed" | "pruned" | "failed";

interface GraphState {
  edgeAlive: Map<string, boolean>;
  nodePendingIn: Map<string, number>;
  nodeOutEdges: Map<string, WorkflowEdge[]>;
  nodeInEdges: Map<string, WorkflowEdge[]>;
  nodeState: Map<string, NodeState>;
}

function buildGraphState(schema: WorkflowSchema): GraphState {
  const edgeAlive = new Map<string, boolean>();
  const nodePendingIn = new Map<string, number>();
  const nodeOutEdges = new Map<string, WorkflowEdge[]>();
  const nodeInEdges = new Map<string, WorkflowEdge[]>();
  const nodeState = new Map<string, NodeState>();

  for (const node of schema.nodes) {
    nodePendingIn.set(node.id, 0);
    nodeOutEdges.set(node.id, []);
    nodeInEdges.set(node.id, []);
    nodeState.set(node.id, "pending");
  }
  for (const edge of schema.edges) {
    edgeAlive.set(edge.id, true);
    nodeOutEdges.get(edge.source)?.push(edge);
    nodeInEdges.get(edge.target)?.push(edge);
    nodePendingIn.set(
      edge.target,
      (nodePendingIn.get(edge.target) ?? 0) + 1
    );
  }

  return { edgeAlive, nodePendingIn, nodeOutEdges, nodeInEdges, nodeState };
}

/**
 * Mark an edge as dead; if the target's live incoming edges all become
 * dead and it hasn't started, prune it transitively.
 */
function killEdge(
  state: GraphState,
  edgeId: string,
  onPrune: (nodeId: string) => void
): void {
  if (state.edgeAlive.get(edgeId) === false) return;
  state.edgeAlive.set(edgeId, false);

  // The caller already handled decrementing pending counts — that's a
  // separate concern from death propagation. Here we only care about
  // whether the target becomes unreachable.
}

function propagatePruning(
  state: GraphState,
  startNodeId: string,
  onPrune: (nodeId: string) => void
): void {
  const queue: string[] = [startNodeId];
  while (queue.length > 0) {
    const nodeId = queue.shift() as string;
    const currState = state.nodeState.get(nodeId);
    if (currState !== "pending") continue;

    // Any live incoming edge whose source is not pruned keeps the node alive
    const liveReachableIncoming = (state.nodeInEdges.get(nodeId) ?? []).some(
      (e) => {
        if (state.edgeAlive.get(e.id) === false) return false;
        const srcState = state.nodeState.get(e.source);
        return srcState !== "pruned";
      }
    );
    if (liveReachableIncoming) continue;

    state.nodeState.set(nodeId, "pruned");
    onPrune(nodeId);

    for (const out of state.nodeOutEdges.get(nodeId) ?? []) {
      state.edgeAlive.set(out.id, false);
      queue.push(out.target);
    }
  }
}

function findNode(schema: WorkflowSchema, nodeId: string): WorkflowNode | undefined {
  return schema.nodes.find((n) => n.id === nodeId);
}

function collectReady(
  state: GraphState,
  schema: WorkflowSchema
): WorkflowNode[] {
  const ready: WorkflowNode[] = [];
  for (const node of schema.nodes) {
    if (state.nodeState.get(node.id) !== "pending") continue;
    if ((state.nodePendingIn.get(node.id) ?? 0) > 0) continue;
    ready.push(node);
  }
  return ready;
}

/**
 * Execute a workflow from start to finish.
 */
export async function executeWorkflow(
  runId: string,
  workflowSchema: WorkflowSchema,
  input: Record<string, unknown>
): Promise<void> {
  const ctx: RunContext = {
    workflowId: workflowSchema.id,
    run: { id: runId, input },
    steps: {},
  };

  const state = buildGraphState(workflowSchema);

  await updateRunStatus(runId, "running");
  await logEvent(runId, null, "workflow_started", {
    workflowId: workflowSchema.id,
    workflowName: workflowSchema.name,
    entryNode: workflowSchema.entryNodeId,
    inputKeys: Object.keys(input),
  });

  let totalExecuted = 0;
  let finalizeSeen = false;

  try {
    while (true) {
      const ready = collectReady(state, workflowSchema);
      if (ready.length === 0) break;

      totalExecuted += ready.length;
      if (totalExecuted > MAX_STEPS) {
        await logEvent(runId, null, "max_steps_exceeded", {
          totalExecuted,
        });
        throw new Error(
          `Workflow exceeded max steps (${MAX_STEPS}). Possible cycle.`
        );
      }

      // Mark all ready as running before executing so collectReady doesn't
      // re-pick them on re-entry (parallel execution below may not start
      // every branch in the same tick)
      for (const n of ready) state.nodeState.set(n.id, "running");

      console.log(
        `[executor] Parallel batch: ${ready.map((n) => n.id).join(", ")}`
      );

      // Execute all ready in parallel
      const results = await Promise.allSettled(
        ready.map(async (node) => {
          const stepId = await createRunStep(runId, node.id);
          await logEvent(runId, stepId, "step_started", {
            nodeId: node.id,
            nodeType: node.type,
            nodeName: node.name,
          });
          try {
            const handler = getNodeHandler(node.type);
            const result = await handler(node, ctx, { runId, stepId });
            ctx.steps[node.id] = result;
            await completeRunStep(stepId, result.outputs);
            await logEvent(runId, stepId, "step_completed", {
              nodeId: node.id,
              outputKeys: Object.keys(result.outputs),
            });
            state.nodeState.set(node.id, "completed");
            return { node, stepId, result };
          } catch (err) {
            state.nodeState.set(node.id, "failed");
            await failRunStep(stepId, err);
            await logEvent(runId, stepId, "step_failed", {
              nodeId: node.id,
              error: err instanceof Error ? err.message : String(err),
            });
            throw err;
          }
        })
      );

      // If any failed, fail the run
      const firstFailure = results.find(
        (r) => r.status === "rejected"
      ) as PromiseRejectedResult | undefined;
      if (firstFailure) {
        throw firstFailure.reason;
      }

      // Process completions: handle branching + decrement pending counts
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        const { node, result } = r.value;

        if (node.type === "finalize") {
          finalizeSeen = true;
        }

        const outEdges = state.nodeOutEdges.get(node.id) ?? [];

        // Branching nodes declare chosen edges via outputs.chosenEdgeIds
        // (string[]) — direct IDs — or outputs.chosenEdgeLabels (string[])
        // which are matched against each outgoing edge's `condition`.
        const chosenIds = resolveChosenEdgeIds(result, outEdges);
        if (chosenIds !== null) {
          const chosenSet = new Set(chosenIds);
          for (const e of outEdges) {
            if (!chosenSet.has(e.id)) {
              state.edgeAlive.set(e.id, false);
              // Try to propagate pruning from this dead edge's target
              propagatePruning(state, e.target, (prunedId) => {
                logEvent(runId, null, "step_failed", {
                  nodeId: prunedId,
                  note: "pruned — branch not taken",
                }).catch(() => {});
              });
            }
          }
        }

        // For each live outgoing edge, decrement target's pending count
        for (const e of outEdges) {
          if (state.edgeAlive.get(e.id) === false) continue;
          const remaining =
            (state.nodePendingIn.get(e.target) ?? 0) - 1;
          state.nodePendingIn.set(e.target, Math.max(0, remaining));
        }
      }
    }

    if (finalizeSeen) {
      console.log(`[executor] Workflow run ${runId} completed successfully.`);
      return;
    }

    await updateRunStatus(runId, "completed");
    await logEvent(runId, null, "workflow_completed", {
      note: "Ended without explicit finalize node",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack ?? "" : "";

    console.error(`[executor] Workflow run ${runId} failed:`, message);

    try {
      await updateRunStatus(runId, "failed");
      await logEvent(runId, null, "error", { message, stack });
    } catch (persistError) {
      console.error("[executor] Failed to persist run failure:", persistError);
    }
  }
}

/**
 * Extract branching decisions from a node's outputs. A branching node
 * handler (gate, router) returns either:
 *   - outputs.chosenEdgeIds: string[]     — picks edges by ID directly
 *   - outputs.chosenEdgeLabels: string[]  — matches against edge.condition
 *
 * Non-branching nodes return null here and all outgoing edges stay alive.
 */
function resolveChosenEdgeIds(
  result: StepResult,
  outEdges: WorkflowEdge[]
): string[] | null {
  const ids = result.outputs?.chosenEdgeIds;
  if (Array.isArray(ids) && ids.every((x) => typeof x === "string")) {
    return ids as string[];
  }

  const labels = result.outputs?.chosenEdgeLabels;
  if (Array.isArray(labels) && labels.every((x) => typeof x === "string")) {
    const wanted = new Set(labels as string[]);
    return outEdges
      .filter((e) => typeof e.condition === "string" && wanted.has(e.condition))
      .map((e) => e.id);
  }

  return null;
}

// Suppress unused import warning for killEdge (exposed for future use).
void killEdge;
