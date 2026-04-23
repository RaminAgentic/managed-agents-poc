/**
 * Flow Builder custom-tool suite.
 *
 * Exposes two operations to a managed agent that generates and publishes
 * workflows:
 *
 *   save_workflow  — validate + insert/update a WorkflowSchema into the DB
 *   list_existing  — list existing workflows so the builder can avoid ID
 *                    collisions and reference proven patterns
 *
 * Saved workflows are immediately visible via the MCP (`list_workflows`,
 * `start_workflow`) and in the web UI's Run History / flow editor — no
 * further registration step is needed.
 */
import type Anthropic from "@anthropic-ai/sdk";
import prisma from "../db/client";
import { validateWorkflowSchema } from "../workflow/schemaValidator";
import { reloadTriggers } from "../workflow/scheduler";

export const FLOW_BUILDER_TOOL_DEFINITIONS: Anthropic.Beta.Agents.BetaManagedAgentsCustomToolParams[] =
  [
    {
      type: "custom",
      name: "save_workflow",
      description:
        "Validate and publish a workflow definition. The workflow becomes immediately callable via the MCP (`start_workflow`) and visible in the web UI. If a workflow with the same `id` already exists, its schema is overwritten (idempotent). Returns { id, name, created: boolean }.",
      input_schema: {
        type: "object",
        properties: {
          schema: {
            type: "object",
            description:
              "A complete WorkflowSchema object: { id, name, version, entryNodeId, nodes[], edges[] }. See the system prompt for the full shape.",
            additionalProperties: true,
          },
        },
        required: ["schema"],
      },
    },
    {
      type: "custom",
      name: "list_existing_workflows",
      description:
        "List every workflow currently in the DB (id + name only). Call this BEFORE generating a new workflow to pick a non-colliding id and see naming conventions.",
      input_schema: {
        type: "object",
        properties: {},
      },
    },
  ];

export const FLOW_BUILDER_TOOL_NAMES = new Set(
  FLOW_BUILDER_TOOL_DEFINITIONS.map((t) => t.name)
);

export async function dispatchFlowBuilderTool(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  try {
    if (name === "save_workflow") return await saveWorkflow(input);
    if (name === "list_existing_workflows") return await listExisting();
    return JSON.stringify({ error: `Unknown flow-builder tool: ${name}` });
  } catch (err) {
    return JSON.stringify({
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function saveWorkflow(input: Record<string, unknown>): Promise<string> {
  const schema = input.schema;
  if (!schema || typeof schema !== "object") {
    return JSON.stringify({
      error: "Missing or invalid `schema` — expected a WorkflowSchema object.",
    });
  }

  const validation = validateWorkflowSchema(schema);
  if (!validation.valid) {
    return JSON.stringify({
      error: "Workflow schema is invalid.",
      details: validation.errors,
    });
  }

  const s = schema as { id: string; name: string };
  const schemaJson = JSON.stringify(schema);

  const existing = await prisma.workflow.findUnique({ where: { id: s.id } });
  let created: boolean;
  if (existing) {
    await prisma.workflow.update({
      where: { id: s.id },
      data: { name: s.name, schemaJson, updatedAt: new Date() },
    });
    created = false;
  } else {
    await prisma.workflow.create({
      data: { id: s.id, name: s.name, schemaJson },
    });
    created = true;
  }
  // v2: rebuild trigger tables so any new cron / webhook registers immediately.
  reloadTriggers().catch((err) =>
    console.warn("[flowBuilder] reloadTriggers failed:", err)
  );
  return JSON.stringify({ id: s.id, name: s.name, created });
}

async function listExisting(): Promise<string> {
  const rows = await prisma.workflow.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return JSON.stringify({ workflows: rows });
}
