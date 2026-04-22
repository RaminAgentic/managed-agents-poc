/**
 * Human Gate node handler — stub.
 *
 * Human-in-the-loop approval gates are a Sprint 8 feature.
 * This stub exists so the NodeType union includes "human_gate"
 * without breaking the handler dispatch map at startup.
 */
import type { WorkflowNode, RunContext, HandlerOptions, StepResult } from "../types";

export async function runHumanGateNode(
  _node: WorkflowNode,
  _ctx: RunContext,
  _opts: HandlerOptions
): Promise<StepResult> {
  throw new Error(
    "NOT_IMPLEMENTED: human_gate execution is not yet supported. " +
    "This node type is available in the visual editor but cannot be executed until Sprint 8."
  );
}
