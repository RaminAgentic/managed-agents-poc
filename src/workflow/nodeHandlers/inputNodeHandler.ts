/**
 * Input Node Handler
 *
 * Validates that all required fields are present in the run input,
 * then passes the input through as outputs so downstream nodes
 * can reference them via $.steps.<inputNodeId>.outputs.<field>.
 *
 * No external API calls — this is a pure validation + pass-through node.
 */
import type {
  WorkflowNode,
  RunContext,
  HandlerOptions,
  StepResult,
  InputNodeConfig,
} from "../types";

export class InputValidationError extends Error {
  public readonly missingFields: string[];

  constructor(nodeId: string, missingFields: string[]) {
    super(
      `Input node "${nodeId}" missing required fields: ${missingFields.join(", ")}`
    );
    this.name = "InputValidationError";
    this.missingFields = missingFields;
  }
}

export async function runInputNode(
  node: WorkflowNode,
  ctx: RunContext,
  _opts: HandlerOptions
): Promise<StepResult> {
  const config = node.config as InputNodeConfig;

  // Build the effective required-field set from either the new `fields`
  // map (preferred) or the legacy `requiredFields` array (back-compat).
  const requiredFromFields = config.fields
    ? Object.entries(config.fields)
        .filter(([, spec]) => spec.required !== false)
        .map(([name]) => name)
    : [];
  const requiredFields = Array.from(
    new Set([...(config.requiredFields ?? []), ...requiredFromFields])
  );

  const missing = requiredFields.filter((f) => !(f in ctx.run.input));
  if (missing.length > 0) {
    throw new InputValidationError(node.id, missing);
  }

  // Pass-through: all input fields become this node's outputs
  return {
    outputs: { ...ctx.run.input },
  };
}
