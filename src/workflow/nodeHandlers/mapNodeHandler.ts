/**
 * Map node (v2): fan-out over a list.
 *
 * Resolves `config.over` to an array (via $-path), then instantiates
 * N copies of `bodyNodeId` in parallel with bounded concurrency. Each
 * copy sees one element under `$.item.<itemVar>`.
 *
 * Body node lookup: `bodyNodeId` must exist in the same workflow as
 * this map node. The body node's static incoming edges are ignored
 * (the map is the sole "logical" driver); the body's handler is invoked
 * directly, without going through the normal scheduler.
 *
 * Aggregates into `outputs.results: { ok, outputs?, error? }[]`.
 */
import type {
  WorkflowNode,
  RunContext,
  HandlerOptions,
  StepResult,
  MapNodeConfig,
} from "../types";
import { resolvePathValue } from "../resolveInputMapping";
import { getNodeHandler } from "./index";
import { createRunStep, completeRunStep, failRunStep, logEvent } from "../persistence";

export async function runMapNode(
  node: WorkflowNode,
  ctx: RunContext,
  opts: HandlerOptions
): Promise<StepResult> {
  const config = node.config as MapNodeConfig;

  if (!ctx.schema) {
    throw new Error(
      `[map] ctx.schema not set for run ${ctx.run.id} — executor must populate it`
    );
  }

  const body = ctx.schema.nodes.find((n) => n.id === config.bodyNodeId);
  if (!body) {
    throw new Error(
      `[map] body node '${config.bodyNodeId}' not found in workflow`
    );
  }

  const rawList = resolvePathValue(config.over, ctx);
  if (!Array.isArray(rawList)) {
    throw new Error(
      `[map] config.over ('${config.over}') did not resolve to an array (got ${typeof rawList})`
    );
  }

  const concurrency = Math.max(1, Math.min(config.concurrency ?? 10, 50));
  const failFast = config.failFast === true;

  console.log(
    `[map] ${node.id} → ${rawList.length} items × ${config.bodyNodeId} (conc=${concurrency}, failFast=${failFast})`
  );

  interface ItemResult {
    index: number;
    ok: boolean;
    outputs?: Record<string, unknown>;
    error?: string;
  }
  const results: ItemResult[] = new Array(rawList.length);

  let cursor = 0;
  let aborted = false;

  const runOne = async (index: number, item: unknown): Promise<void> => {
    if (aborted) {
      results[index] = { index, ok: false, error: "aborted" };
      return;
    }
    // Per-item sub-context: same run, but an `item` key is exposed.
    const subCtx: RunContext = {
      workflowId: ctx.workflowId,
      run: ctx.run,
      steps: { ...ctx.steps },
      schema: ctx.schema,
      item: { [config.itemVar]: item },
    };

    const stepId = await createRunStep(ctx.run.id, `${node.id}[${index}]`);
    await logEvent(ctx.run.id, stepId, "step_started", {
      nodeId: `${node.id}[${index}]`,
      nodeType: body.type,
      nodeName: body.name,
      mapIndex: index,
    });

    try {
      const handler = getNodeHandler(body.type);
      const r = await handler(body, subCtx, { runId: opts.runId, stepId });
      await completeRunStep(stepId, r.outputs);
      await logEvent(ctx.run.id, stepId, "step_completed", {
        nodeId: `${node.id}[${index}]`,
        outputKeys: Object.keys(r.outputs),
      });
      results[index] = { index, ok: true, outputs: r.outputs };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await failRunStep(stepId, err);
      await logEvent(ctx.run.id, stepId, "step_failed", {
        nodeId: `${node.id}[${index}]`,
        error: message,
      });
      results[index] = { index, ok: false, error: message };
      if (failFast) {
        aborted = true;
        throw err;
      }
    }
  };

  const workers: Promise<void>[] = [];
  const next = async (): Promise<void> => {
    while (cursor < rawList.length && !aborted) {
      const myIndex = cursor++;
      await runOne(myIndex, rawList[myIndex]);
    }
  };
  for (let w = 0; w < concurrency; w++) workers.push(next());

  if (failFast) {
    await Promise.all(workers);
  } else {
    await Promise.allSettled(workers);
  }

  const succeeded = results.filter((r) => r && r.ok).length;
  const failed = results.filter((r) => r && !r.ok).length;

  if (failFast && failed > 0) {
    throw new Error(
      `[map] failFast: ${failed}/${rawList.length} items failed`
    );
  }

  return {
    outputs: {
      total: rawList.length,
      succeeded,
      failed,
      results,
    },
  };
}
