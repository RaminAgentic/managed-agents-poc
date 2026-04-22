/**
 * Gate Node Handler — deterministic T/F conditional branch.
 *
 * Evaluates the node's `expression` against a sandboxed view of the run
 * context and returns the chosen outgoing edge ID for the executor.
 *
 * Outgoing edges must carry `condition: "true"` and `condition: "false"`
 * (the UI enforces this when wiring a gate). The chosen edge is picked
 * based on the boolean result of the expression.
 *
 * Expression scope:
 *   - `input.<field>`            — the run's input
 *   - `steps.<nodeId>.<field>`   — any prior step's output (e.g. steps.reader.parsed)
 *   - Standard JS operators and literals are allowed.
 *
 * Security: expressions run in a `new Function(...)` — not a full sandbox.
 * The workflow author is trusted (they built the flow). Do not expose
 * user-submitted expressions here.
 */
import type {
  WorkflowNode,
  RunContext,
  HandlerOptions,
  StepResult,
  GateNodeConfig,
} from "../types";

function buildScope(ctx: RunContext): Record<string, unknown> {
  const stepsFlat: Record<string, unknown> = {};
  for (const [nodeId, result] of Object.entries(ctx.steps)) {
    stepsFlat[nodeId] = result.outputs;
  }
  return {
    input: ctx.run.input,
    steps: stepsFlat,
  };
}

function evaluateExpression(
  expression: string,
  scope: Record<string, unknown>
): boolean {
  try {
    const fn = new Function(
      "input",
      "steps",
      `"use strict"; return (${expression});`
    );
    const result = fn(scope.input, scope.steps);
    return Boolean(result);
  } catch (err) {
    throw new Error(
      `Gate expression failed to evaluate: ${(err as Error).message}`
    );
  }
}

export async function runGateNode(
  node: WorkflowNode,
  ctx: RunContext,
  _opts: HandlerOptions
): Promise<StepResult> {
  const config = node.config as GateNodeConfig;
  if (!config.expression || typeof config.expression !== "string") {
    throw new Error(`Gate node "${node.id}" missing 'expression'`);
  }

  const scope = buildScope(ctx);
  const result = evaluateExpression(config.expression, scope);

  const wantedCondition = result ? "true" : "false";

  // Executor injects the schema edges into ctx via a side channel? No —
  // the executor calls this handler with only ctx + opts. We need access
  // to the node's outgoing edges to pick the right edge ID.
  //
  // Solution: the executor matches chosenEdgeLabels → edge.condition.
  return {
    outputs: {
      result,
      chosenEdgeLabels: [wantedCondition],
    },
  };
}
