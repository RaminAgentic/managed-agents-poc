/**
 * Workflow Definition API routes.
 *
 * POST /api/workflows            — create a workflow definition
 * GET  /api/workflows            — list all workflows
 * GET  /api/workflows/:id        — get a single workflow (with parsed schema)
 * GET  /api/workflows/:id/runs   — list runs for a workflow
 */
import { Router, Request, Response } from "express";
import crypto from "crypto";
import { validateWorkflowSchema } from "../workflow/schemaValidator";
import {
  createWorkflow,
  updateWorkflow,
  getWorkflow,
  listWorkflows,
  getRunsByWorkflowId,
} from "../workflow/persistence";

const router = Router();

/**
 * Shared schema normalization — called by both POST and PUT handlers
 * to ensure consistent edge/field naming in the DB.
 */
function normalizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...schema };

  // Normalize edge field names: from/to → source/target
  // The executor and React Flow use source/target internally;
  // the validator accepts both from/to and source/target.
  if (Array.isArray(normalized.edges)) {
    normalized.edges = (normalized.edges as Array<Record<string, unknown>>).map((edge) => ({
      ...edge,
      source: edge.source ?? edge.from,
      target: edge.target ?? edge.to,
    }));
  }

  // Normalize top-level fields: flowId → id, schemaVersion → version
  if (normalized.flowId && !normalized.id) {
    normalized.id = normalized.flowId;
  }
  if (normalized.schemaVersion && !normalized.version) {
    normalized.version = normalized.schemaVersion;
  }

  return normalized;
}

/**
 * POST /api/workflows
 * Body: { name: string, schema: object }
 *
 * Validates the workflow schema, persists it, and returns the created ID.
 */
router.post("/workflows", async (req: Request, res: Response) => {
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

    // Validate the workflow schema with strict rules
    const validation = validateWorkflowSchema(schema);
    if (!validation.valid) {
      res.status(400).json({ error: "Invalid workflow schema", details: validation.errors });
      return;
    }

    const normalizedSchema = normalizeSchema(schema as Record<string, unknown>);

    // Use schema's flowId/id as the DB id, or generate one
    const flowId = normalizedSchema.flowId ?? normalizedSchema.id;
    const id = (typeof flowId === "string" && flowId.trim())
      ? flowId
      : `wf-${crypto.randomUUID().slice(0, 8)}`;
    const schemaJson = JSON.stringify(normalizedSchema);

    await createWorkflow(id, name.trim(), schemaJson);

    // Return full created record so clients don't need a follow-up GET
    res.status(201).json({
      id,
      name: name.trim(),
      version: 1,
      schema: normalizedSchema,
      createdAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    console.error("[workflowRoutes] POST /workflows error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    // Handle duplicate ID (Prisma unique constraint)
    if (message.includes("Unique constraint")) {
      res.status(409).json({ error: "Workflow with this ID already exists" });
      return;
    }
    res.status(500).json({ error: message });
  }
});

/**
 * PUT /api/workflows/:id
 * Body: { name: string, schema: object }
 *
 * Updates an existing workflow definition. Returns 404 if the workflow
 * does not exist, 400 if the schema is invalid.
 */
router.put("/workflows/:id", async (req: Request, res: Response) => {
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

    // Validate the workflow schema with strict rules
    const validation = validateWorkflowSchema(schema);
    if (!validation.valid) {
      res.status(400).json({ error: "Invalid workflow schema", details: validation.errors });
      return;
    }

    // Check existence first
    const existing = await getWorkflow(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }

    const normalizedSchema = normalizeSchema(schema as Record<string, unknown>);
    const schemaJson = JSON.stringify(normalizedSchema);

    const updated = await updateWorkflow(req.params.id, name.trim(), schemaJson);

    res.status(200).json({
      id: updated.id,
      name: updated.name,
      version: updated.version,
      schema: normalizedSchema,
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
    });
  } catch (err: unknown) {
    console.error("[workflowRoutes] PUT /workflows/:id error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    // Prisma P2025: Record not found (race condition between existence check and update)
    if (message.includes("Record to update not found") || message.includes("P2025")) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/workflows
 * Returns: { workflows: [{ id, name, version, createdAt }] }
 */
router.get("/workflows", async (_req: Request, res: Response) => {
  try {
    const workflows = await listWorkflows();
    res.json({
      workflows: workflows.map((w) => ({
        id: w.id,
        name: w.name,
        version: w.version,
        createdAt: w.created_at,
      })),
    });
  } catch (err: unknown) {
    console.error("[workflowRoutes] GET /workflows error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * GET /api/workflows/:id
 * Returns: { id, name, version, schema, createdAt }
 */
router.get("/workflows/:id", async (req: Request, res: Response) => {
  try {
    const workflow = await getWorkflow(req.params.id);
    if (!workflow) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }
    res.json({
      id: workflow.id,
      name: workflow.name,
      version: workflow.version,
      schema: JSON.parse(workflow.schema_json),
      createdAt: workflow.created_at,
    });
  } catch (err: unknown) {
    console.error("[workflowRoutes] GET /workflows/:id error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * GET /api/workflows/:id/runs
 * Returns: { runs: [...] }
 */
router.get("/workflows/:id/runs", async (req: Request, res: Response) => {
  try {
    const workflow = await getWorkflow(req.params.id);
    if (!workflow) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }
    const runs = await getRunsByWorkflowId(req.params.id);
    res.json({ runs });
  } catch (err: unknown) {
    console.error("[workflowRoutes] GET /workflows/:id/runs error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
