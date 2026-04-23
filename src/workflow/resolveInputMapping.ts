/**
 * Input mapping resolver for workflow nodes.
 *
 * Resolves JSONPath-like expressions from the run context:
 *   - $.run.input.<field>           → value from workflow run input
 *   - $.steps.<nodeId>.outputs.<field> → value from a prior step's outputs
 *
 * Intentionally narrow scope for v1 — hand-rolled, no external deps.
 */
import type { RunContext } from "./types";

export class InputMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputMappingError";
  }
}

/**
 * Resolve a single JSONPath-like expression against the run context.
 * Exported for callers (map handler, etc) that need single-path lookup.
 */
export function resolvePathValue(path: string, ctx: RunContext): unknown {
  return resolvePath(path, ctx);
}

function resolvePath(path: string, ctx: RunContext): unknown {
  if (!path.startsWith("$.")) {
    // Not a path expression — return as literal value
    return path;
  }

  const parts = path.slice(2).split(".");

  if (parts[0] === "run" && parts[1] === "input" && parts.length >= 3) {
    // $.run.input.<field>[.<nested>...]
    let value: unknown = ctx.run.input;
    for (let i = 2; i < parts.length; i++) {
      if (value === null || value === undefined || typeof value !== "object") {
        throw new InputMappingError(
          `Cannot resolve path '${path}': segment '${parts[i]}' not found (value is ${typeof value})`
        );
      }
      value = (value as Record<string, unknown>)[parts[i]];
    }
    return value;
  }

  if (parts[0] === "item" && parts.length >= 2) {
    // $.item.<var>[.<nested>...] — set by the map handler per iteration
    let value: unknown = ctx.item ?? {};
    for (let i = 1; i < parts.length; i++) {
      if (value === null || value === undefined || typeof value !== "object") {
        throw new InputMappingError(
          `Cannot resolve path '${path}': segment '${parts[i]}' not found (value is ${typeof value})`
        );
      }
      value = (value as Record<string, unknown>)[parts[i]];
    }
    return value;
  }

  if (parts[0] === "steps" && parts.length >= 4 && parts[2] === "outputs") {
    // $.steps.<nodeId>.outputs.<field>[.<nested>...]
    const nodeId = parts[1];
    const step = ctx.steps[nodeId];
    if (!step) {
      throw new InputMappingError(
        `Cannot resolve path '${path}': step '${nodeId}' has not executed yet`
      );
    }
    let value: unknown = step.outputs;
    for (let i = 3; i < parts.length; i++) {
      if (value === null || value === undefined || typeof value !== "object") {
        throw new InputMappingError(
          `Cannot resolve path '${path}': segment '${parts[i]}' not found (value is ${typeof value})`
        );
      }
      value = (value as Record<string, unknown>)[parts[i]];
    }
    return value;
  }

  throw new InputMappingError(
    `Unsupported path expression: '${path}'. ` +
      `Supported patterns: $.run.input.<field>, $.steps.<nodeId>.outputs.<field>`
  );
}

/**
 * Resolve all input mappings for a node against the run context.
 *
 * @param mapping - Object where keys are variable names and values are path expressions
 * @param ctx - Current run context
 * @returns Resolved key-value pairs
 */
export function resolveInputMapping(
  mapping: Record<string, string>,
  ctx: RunContext
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, pathExpr] of Object.entries(mapping)) {
    resolved[key] = resolvePath(pathExpr, ctx);
  }

  return resolved;
}

/**
 * Substitute {{variable}} placeholders in a template string.
 *
 * Missing variables are left as literal {{varName}} — the model can
 * complain rather than silently receiving empty values.
 */
export function substituteTemplate(
  template: string,
  vars: Record<string, unknown>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = vars[key];
    if (value === undefined || value === null) {
      console.warn(`[substituteTemplate] Missing variable: '${key}' — leaving as literal`);
      return match;
    }
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}
