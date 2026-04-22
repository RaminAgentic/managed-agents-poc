/**
 * Workflow Run API routes.
 *
 * POST /api/workflows            — create a workflow definition
 * GET  /api/workflows            — list all workflows
 * GET  /api/workflows/:id        — get a single workflow
 * POST /api/runs                 — start a workflow run (fire-and-forget)
 * GET  /api/runs/:id             — get run status
 * GET  /api/runs/:id/steps       — get steps + events for monitoring UI
 */
import { Router, Request, Response } from "express";
import crypto from "crypto";
import type { WorkflowSchema } from "../workflow/types";
import { validateWorkflowSchema } from "../workflow/validateSchema";
import { executeWorkflow } from "../workflow/executor";
import {
  createWorkflow,
  getWorkflow,
  listWorkflows,
  createWorkflowRun,
  getWorkflowRun,
  getRunSteps,
  getRunEvents,
  getRunsByWorkflowId,
} from "../workflow/persistence";

const router = Router();

// ── Workflow CRUD ───────────────────────────────────────────────────

/**
 * POST /api/workflows
 * Body: { name: string, schema: WorkflowSchema }
 */
router.post("/workflows", (req: Request, res: Response) => {
  try {
    const { name, schema } = req.body;

    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "'name' is required and must be a string" });
      return;
    }
    if (!schema || typeof schema !== "object") {
      res.status(400).json({ error: "'schema' is required and must be an object" });
      return;
    }

    // Validate the workflow schema
    const validation = validateWorkflowSchema(schema);
    if (!validation.ok) {
      res.status(400).json({ error: "Invalid workflow schema", details: validation.errors });
      return;
    }

    const id = schema.id || `wf-${crypto.randomUUID().slice(0, 8)}`;
    const schemaJson = JSON.stringify(schema);

    createWorkflow(id, name, schemaJson);
    res.status(201).json({ id, name, message: "Workflow created" });
  } catch (err: unknown) {
    console.error("[runRoutes] POST /workflows error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    // Handle duplicate ID
    if (message.includes("UNIQUE constraint")) {
      res.status(409).json({ error: "Workflow with this ID already exists" });
      return;
    }
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/workflows
 */
router.get("/workflows", (_req: Request, res: Response) => {
  try {
    const workflows = listWorkflows();
    res.json({ workflows });
  } catch (err: unknown) {
    console.error("[runRoutes] GET /workflows error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * GET /api/workflows/:id
 */
router.get("/workflows/:id", (req: Request, res: Response) => {
  try {
    const workflow = getWorkflow(req.params.id);
    if (!workflow) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }
    res.json({
      ...workflow,
      schema: JSON.parse(workflow.schema_json),
    });
  } catch (err: unknown) {
    console.error("[runRoutes] GET /workflows/:id error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * GET /api/workflows/:id/runs
 */
router.get("/workflows/:id/runs", (req: Request, res: Response) => {
  try {
    const workflow = getWorkflow(req.params.id);
    if (!workflow) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }
    const runs = getRunsByWorkflowId(req.params.id);
    res.json({ runs });
  } catch (err: unknown) {
    console.error("[runRoutes] GET /workflows/:id/runs error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ── Run Execution ───────────────────────────────────────────────────

/**
 * POST /api/runs
 * Body: { workflowId: string, input: Record<string, unknown> }
 *
 * Creates a WorkflowRun record and launches the executor in a
 * fire-and-forget pattern. Returns 202 Accepted immediately.
 */
router.post("/runs", (req: Request, res: Response) => {
  try {
    const { workflowId, input } = req.body;

    if (!workflowId || typeof workflowId !== "string") {
      res.status(400).json({ error: "'workflowId' is required" });
      return;
    }

    // Load the workflow
    const workflow = getWorkflow(workflowId);
    if (!workflow) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }

    // Parse and validate the schema
    const schema = JSON.parse(workflow.schema_json) as WorkflowSchema;
    const validation = validateWorkflowSchema(schema);
    if (!validation.ok) {
      res.status(400).json({
        error: "Stored workflow schema is invalid",
        details: validation.errors,
      });
      return;
    }

    // Create the run record
    const runInput = input && typeof input === "object" ? input : {};
    const runId = createWorkflowRun(workflowId, runInput);

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
    executeWorkflow(runId, schema, runInput).catch((err) => {
      console.error(`[runRoutes] Unhandled error in run ${runId}:`, err);
    });

    res.status(202).json({ runId, status: "pending" });
  } catch (err: unknown) {
    console.error("[runRoutes] POST /runs error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * GET /api/runs/:id
 * Returns the run record with status.
 */
router.get("/runs/:id", (req: Request, res: Response) => {
  try {
    const run = getWorkflowRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    res.json(run);
  } catch (err: unknown) {
    console.error("[runRoutes] GET /runs/:id error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * GET /api/runs/:id/steps
 * Returns all RunSteps and RunEvents for monitoring UI.
 */
router.get("/runs/:id/steps", (req: Request, res: Response) => {
  try {
    const run = getWorkflowRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }

    const steps = getRunSteps(req.params.id);
    const events = getRunEvents(req.params.id);

    res.json({ steps, events });
  } catch (err: unknown) {
    console.error("[runRoutes] GET /runs/:id/steps error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
