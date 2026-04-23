/**
 * Workflow Run API routes.
 *
 * POST /api/runs                 — start a workflow run (fire-and-forget)
 * GET  /api/runs                 — list recent runs
 * GET  /api/runs/:id             — get run detail with steps + events
 * GET  /api/runs/:id/steps       — get steps + events for monitoring UI
 */
import { Router, Request, Response } from "express";
import type { WorkflowSchema } from "../workflow/types";
import { validateWorkflowSchema } from "../workflow/schemaValidator";
import { executeWorkflow } from "../workflow/executor";
import {
  getWorkflow,
  createWorkflowRun,
  getWorkflowRun,
  getWorkflowRunWithDetails,
  listRuns,
  getRunSteps,
  getRunEvents,
  updateRunStatus,
  requestRunCancel,
} from "../workflow/persistence";

const router = Router();

/**
 * POST /api/runs
 * Body: { workflowId: string, input: Record<string, unknown> }
 *
 * Creates a WorkflowRun record and launches the executor in a
 * fire-and-forget pattern. Returns 202 Accepted immediately.
 */
router.post("/runs", async (req: Request, res: Response) => {
  try {
    const { workflowId, input } = req.body;

    if (!workflowId || typeof workflowId !== "string") {
      res.status(400).json({ error: "'workflowId' is required" });
      return;
    }

    // Load the workflow
    const workflow = await getWorkflow(workflowId);
    if (!workflow) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }

    // Parse and validate the schema
    const schema = JSON.parse(workflow.schema_json) as WorkflowSchema;
    const validation = validateWorkflowSchema(schema);
    if (!validation.valid) {
      res.status(400).json({
        error: "Stored workflow schema is invalid",
        details: validation.errors,
      });
      return;
    }

    // Create the run record
    const runInput = input && typeof input === "object" ? input : {};
    const runId = await createWorkflowRun(workflowId, runInput);

    // Feature gate: check env var
    if (process.env.ENABLE_WORKFLOW_EXECUTOR === "false") {
      res.status(202).json({
        runId,
        status: "pending",
        message: "Executor disabled — run created but not started",
      });
      return;
    }

    // Fire-and-forget — do NOT await
    // The .catch is non-optional: unhandled rejections crash Node.
    executeWorkflow(runId, schema, runInput).catch(async (err) => {
      console.error(`[runRoutes] Unhandled error in run ${runId}:`, err);
      // Ensure the run is marked as failed even on catastrophic errors
      try {
        await updateRunStatus(runId, "failed");
      } catch (persistErr) {
        console.error(`[runRoutes] Failed to mark run ${runId} as failed:`, persistErr);
      }
    });

    res.status(202).json({ runId, status: "pending" });
  } catch (err: unknown) {
    console.error("[runRoutes] POST /runs error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * GET /api/runs
 * Returns: [{ id, workflowId, status, createdAt }] — most recent 50.
 */
router.get("/runs", async (_req: Request, res: Response) => {
  try {
    const runs = await listRuns(50);
    res.json({
      runs: runs.map((r) => ({
        id: r.id,
        workflowId: r.workflow_id,
        workflowName: r.workflow_name,
        status: r.status,
        createdAt: r.created_at,
      })),
    });
  } catch (err: unknown) {
    console.error("[runRoutes] GET /runs error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * GET /api/runs/:id
 * Returns: { ...run, steps: [...], events: [...] }
 * Events ordered by createdAt ASC, steps ordered by startedAt ASC.
 */
router.get("/runs/:id", async (req: Request, res: Response) => {
  try {
    const detail = await getWorkflowRunWithDetails(req.params.id);
    if (!detail) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    res.json({
      ...detail.run,
      steps: detail.steps,
      events: detail.events,
    });
  } catch (err: unknown) {
    console.error("[runRoutes] GET /runs/:id error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * GET /api/runs/:id/steps
 * Returns: { steps: [...], events: [...] } for the monitoring UI.
 */
router.get("/runs/:id/steps", async (req: Request, res: Response) => {
  try {
    const run = await getWorkflowRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }

    const steps = await getRunSteps(req.params.id);
    const events = await getRunEvents(req.params.id);

    res.json({ steps, events });
  } catch (err: unknown) {
    console.error("[runRoutes] GET /runs/:id/steps error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * POST /api/runs/:id/cancel
 *
 * Flags a run for cancellation. The executor checks the flag between
 * steps and transitions to `cancelled` at the next check point. Does
 * not interrupt a step that's already in flight — that would require
 * session-level cancellation which Anthropic doesn't expose.
 */
router.post("/runs/:id/cancel", async (req: Request, res: Response) => {
  try {
    const run = await getWorkflowRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    const terminal = ["completed", "failed", "cancelled"];
    if (terminal.includes(run.status)) {
      res.status(409).json({
        error: `Run is already ${run.status}`,
        status: run.status,
      });
      return;
    }
    await requestRunCancel(req.params.id);
    res.json({ runId: req.params.id, status: "cancel_requested" });
  } catch (err: unknown) {
    console.error("[runRoutes] POST /runs/:id/cancel error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
