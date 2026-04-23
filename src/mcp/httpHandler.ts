/**
 * HTTP MCP Handler — Streamable-HTTP transport for Claude for Work connectors.
 *
 * Exposes the same 5 Flow Manager tools as the stdio MCP server (mcp/),
 * but calls the Prisma/service layer directly instead of round-tripping
 * through the REST API.
 *
 * IMPORTANT: Do NOT import from mcp/src/** — that package is ESM-only with
 * its own tsconfig. All tool schemas are replicated here.
 *
 * KEEP IN SYNC with mcp/src/tools/*.ts — tool names, descriptions, and
 * input schemas must match the stdio versions.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import { z } from "zod";
import crypto from "crypto";

import * as persistence from "../workflow/persistence";
import { validateWorkflowSchema } from "../workflow/schemaValidator";
import { executeWorkflow } from "../workflow/executor";
import { updateRunStatus } from "../workflow/persistence";
import type { WorkflowSchema } from "../workflow/types";
import { renderRunAsReactArtifact } from "../workflow/renderRunArtifact";
import { renderWorkflowMermaid } from "../workflow/renderMermaid";
import {
  startConciergeRun,
  pollConciergeResult,
} from "../agent/salesforceConcierge";

// ── Tool Schemas ───────────────────────────────────────────────────────
// Replicated from mcp/src/tools/*.ts — KEEP IN SYNC

const listWorkflowsSchema = z.object({});

const describeWorkflowSchema = z.object({
  workflowId: z
    .string()
    .min(1)
    .describe("The ID of the workflow to describe (use list_workflows to find IDs)"),
});

const startWorkflowSchema = z.object({
  workflowId: z.string().min(1).describe("The ID of the workflow to start"),
  input: z
    .record(z.unknown())
    .optional()
    .default({})
    .describe(
      "Input data for the workflow run as a JSON object. The shape depends on the workflow's input fields — call describe_workflow FIRST to learn what fields are required and their types, then ask the user for the values conversationally (don't require them to type JSON themselves)."
    ),
});

const getRunStatusSchema = z.object({
  runId: z.string().min(1).describe("The ID of the workflow run to check"),
});

const listRunsSchema = z.object({});

const salesforceConciergeSchema = z.object({
  request: z
    .string()
    .min(1)
    .describe(
      "Describe what you want done with Salesforce, in plain English. Examples: 'I just met with Acme Toys, log a ~$200k enterprise opp for Q3', 'how's our pipeline this quarter', 'who are the slipping deals over $100k'. The agent will find-or-create the necessary records, enrich from the web if useful, and for reports return a React chart you can render as an artifact. Runs through the standard wf-concierge workflow so every call is visible in Run History."
    ),
});


const AGENT_NODE_GUIDE = `
Each workflow node is one of:
  - input:      { id, type: 'input', name, config: { requiredFields?: string[] } }
  - agent:      { id, type: 'agent', name, config: <AgentNodeConfig>, modelConfig?: { model?, effort? } }
  - human_gate: { id, type: 'human_gate', name, config: { channel, messageTemplate, decisionValues: string[] } }
  - finalize:   { id, type: 'finalize', name, config: { summaryFields?: string[] } }

AgentNodeConfig shape (agents are Managed Agents — configured once here, executed per run):
  {
    instructions: string,          // system prompt for the managed agent
    inputMapping?: { [varName]: "$.run.input.<field>" | "$.steps.<nodeId>.outputs.<field>" },
    timeoutSeconds?: number,       // default 300
    outputFormat?: "text" | "json",
    mcpServers?: [{ name, type: "url", url }],   // remote MCP servers the agent can use
    tools?: [                                    // pass-through to beta.agents.create
      { type: "agent_toolset_20260401" },
      { type: "mcp_toolset", mcp_server_name: "<name from mcpServers>",
        default_config: { permission_policy: { type: "always_allow" } } }
    ],
    skills?: [{ type: "anthropic", skill_id: "docx" }]   // Anthropic-authored skills
  }

Known remote MCP servers you can reference (use these exact URLs):
  - Slack:        https://mcp.slack.com/mcp
  - Salesforce:   https://mcp.salesforce.com/mcp
  - Linear:       https://mcp.linear.app/mcp
  - Sentry:       https://mcp.sentry.dev/mcp
  - Notion:       https://mcp.notion.com/mcp
  - GitHub:       https://api.githubcopilot.com/mcp/
  - Atlassian:    https://mcp.atlassian.com/v1/sse
  - Google Drive: https://mcp.google.com/drive
  - Gmail:        https://mcp.google.com/gmail
  - Google Calendar: https://mcp.google.com/calendar

Known Anthropic skills: "docx" (Word documents), "xlsx" (spreadsheets), "pdf", "pptx".

Example agent node (a Slack + Salesforce deal-desk reviewer):
{
  "id": "review",
  "type": "agent",
  "name": "Deal desk reviewer",
  "modelConfig": { "model": "claude-opus-4-7", "effort": "high" },
  "config": {
    "instructions": "You review deals against pricing policy. Read the opportunity, compare discount to our comps, then post a summary with approve/reject buttons to #deal-desk in Slack. Wait for a reaction, then write the decision back to the opportunity as a Chatter post.",
    "mcpServers": [
      { "name": "salesforce", "type": "url", "url": "https://mcp.salesforce.com/mcp" },
      { "name": "slack",      "type": "url", "url": "https://mcp.slack.com/mcp" }
    ],
    "tools": [
      { "type": "agent_toolset_20260401" },
      { "type": "mcp_toolset", "mcp_server_name": "salesforce",
        "default_config": { "permission_policy": { "type": "always_allow" } } },
      { "type": "mcp_toolset", "mcp_server_name": "slack",
        "default_config": { "permission_policy": { "type": "always_allow" } } }
    ]
  }
}

Rules:
- Every workflow must have exactly one finalize node.
- Use edges of the form { from: <nodeId>, to: <nodeId> } to wire nodes together.
- An agent node's instructions should be full system prompts — detailed, step-by-step, specific about what to post where.
`.trim();

const createWorkflowSchema = z.object({
  name: z.string().min(1).describe("Name of the workflow"),
  nodes: z
    .array(z.record(z.unknown()))
    .describe(`Array of workflow node objects.\n\n${AGENT_NODE_GUIDE}`),
  edges: z
    .array(z.record(z.unknown()))
    .describe(
      "Array of workflow edges: [{ from: string, to: string }, ...]. Both values are node IDs."
    ),
  entryNodeId: z
    .string()
    .optional()
    .describe(
      "ID of the entry node. Defaults to the first node's ID if not provided."
    ),
});

// ── Tool Handlers ──────────────────────────────────────────────────────

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

async function handleSalesforceConcierge(
  input: z.infer<typeof salesforceConciergeSchema>
): Promise<ToolResult> {
  try {
    // Start the real wf-concierge workflow and long-poll the run's DB
    // state. No parallel execution path — the concierge is a normal
    // governed flow visible in Run History.
    const { runId } = await startConciergeRun(input.request);

    const DEADLINE_MS = 120_000;
    const POLL_INTERVAL_MS = 1_000;
    const deadline = Date.now() + DEADLINE_MS;

    while (Date.now() < deadline) {
      const result = await pollConciergeResult(runId);
      if (result.status === "completed") {
        return { content: [{ type: "text", text: result.text }] };
      }
      if (result.status === "failed") {
        return {
          content: [
            {
              type: "text",
              text: `Concierge failed: ${result.error ?? "unknown error"}`,
            },
          ],
          isError: true,
        };
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    const partial = await pollConciergeResult(runId);
    return {
      content: [
        {
          type: "text",
          text: partial.text
            ? partial.text +
              "\n\n_(Still finalizing — this may continue in the background. View the full run at /runs/" +
              runId +
              ")_"
            : `The concierge is taking longer than expected. View progress at /runs/${runId}.`,
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Concierge error: ${(err as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

async function handleDescribeWorkflow(
  input: z.infer<typeof describeWorkflowSchema>
): Promise<ToolResult> {
  try {
    const workflow = await persistence.getWorkflow(input.workflowId);
    if (!workflow) {
      return {
        content: [
          { type: "text", text: `Error: Workflow '${input.workflowId}' not found.` },
        ],
        isError: true,
      };
    }

    let schema: WorkflowSchema;
    try {
      schema = JSON.parse(workflow.schema_json) as WorkflowSchema;
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Could not parse workflow schema: ${(err as Error).message}`,
          },
        ],
        isError: true,
      };
    }

    const entryNode = schema.nodes.find((n) => n.id === schema.entryNodeId);
    const inputCfg = (entryNode?.config ?? {}) as {
      description?: string;
      fields?: Record<
        string,
        {
          description?: string;
          type?: string;
          required?: boolean;
          example?: string;
        }
      >;
      requiredFields?: string[];
    };

    const purpose =
      inputCfg.description ?? `Workflow "${workflow.name}" — no description provided.`;

    // Build a normalized input-fields description
    const fieldLines: string[] = [];
    if (inputCfg.fields && Object.keys(inputCfg.fields).length > 0) {
      for (const [name, spec] of Object.entries(inputCfg.fields)) {
        const parts: string[] = [`  - **${name}** (${spec.type ?? "string"}${spec.required === false ? ", optional" : ""})`];
        if (spec.description) parts.push(`: ${spec.description}`);
        if (spec.example) parts.push(` — example: \`${spec.example}\``);
        fieldLines.push(parts.join(""));
      }
    } else if (inputCfg.requiredFields && inputCfg.requiredFields.length > 0) {
      for (const name of inputCfg.requiredFields) {
        fieldLines.push(`  - **${name}** (string, required)`);
      }
    }

    const nodeSummary = schema.nodes
      .filter((n) => n.type !== "input" && n.type !== "finalize")
      .map((n) => `  - ${n.type}: **${n.name}** (id: \`${n.id}\`)`)
      .join("\n");

    const conversationalHint =
      fieldLines.length > 0
        ? `\n**To start this workflow:** gather the values above from the user in a natural conversation (don't make them type JSON). When you have them, call \`start_workflow\` with \`workflowId: "${workflow.id}"\` and an \`input\` object mapping each field name to the value the user gave you.`
        : `\n**To start this workflow:** call \`start_workflow\` with \`workflowId: "${workflow.id}"\` and an empty \`input: {}\`.`;

    const text = [
      `## ${workflow.name}`,
      `**ID:** \`${workflow.id}\` · **Version:** ${workflow.version}`,
      "",
      `**Purpose:** ${purpose}`,
      "",
      fieldLines.length > 0 ? "**Inputs the workflow needs:**" : "**Inputs:** none required.",
      ...fieldLines,
      "",
      nodeSummary ? "**Steps the workflow performs:**" : "",
      nodeSummary,
      conversationalHint,
    ]
      .filter((l) => l !== null && l !== undefined)
      .join("\n");

    return { content: [{ type: "text", text }] };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Error describing workflow: ${(err as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

async function handleListWorkflows(): Promise<ToolResult> {
  try {
    const workflows = await persistence.listWorkflows();

    if (workflows.length === 0) {
      return { content: [{ type: "text", text: "No workflows found." }] };
    }

    const lines = workflows.map(
      (w) => `- **${w.name}** (id: ${w.id}, version: ${w.version})`
    );

    return {
      content: [
        {
          type: "text",
          text: `Found ${workflows.length} workflow(s):\n\n${lines.join("\n")}`,
        },
      ],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error listing workflows: ${(err as Error).message}` }],
      isError: true,
    };
  }
}

async function handleStartWorkflow(
  input: z.infer<typeof startWorkflowSchema>
): Promise<ToolResult> {
  try {
    // Load the workflow
    const workflow = await persistence.getWorkflow(input.workflowId);
    if (!workflow) {
      return {
        content: [{ type: "text", text: `Error: Workflow '${input.workflowId}' not found.` }],
        isError: true,
      };
    }

    // Parse and validate the schema
    const schema = JSON.parse(workflow.schema_json) as WorkflowSchema;
    const validation = validateWorkflowSchema(schema);
    if (!validation.valid) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Stored workflow schema is invalid: ${validation.errors.join(", ")}`,
          },
        ],
        isError: true,
      };
    }

    // Create the run record
    const runInput = input.input && typeof input.input === "object" ? input.input : {};
    const runId = await persistence.createWorkflowRun(input.workflowId, runInput);

    // Feature gate: check env var (mirrors runRoutes.ts behavior)
    if (process.env.ENABLE_WORKFLOW_EXECUTOR === "false") {
      return {
        content: [
          {
            type: "text",
            text: `Workflow run created (executor disabled).\n\n- **Run ID**: ${runId}\n- **Status**: pending\n\nNote: Executor is disabled via ENABLE_WORKFLOW_EXECUTOR=false.`,
          },
        ],
      };
    }

    // Fire-and-forget — mirrors runRoutes.ts exactly
    executeWorkflow(runId, schema, runInput).catch(async (err) => {
      console.error(`[mcp] Unhandled error in run ${runId}:`, err);
      try {
        await updateRunStatus(runId, "failed");
      } catch (persistErr) {
        console.error(`[mcp] Failed to mark run ${runId} as failed:`, persistErr);
      }
    });

    return {
      content: [
        {
          type: "text",
          text: `Workflow run started successfully!\n\n- **Run ID**: ${runId}\n- **Status**: pending\n\nUse \`get_run_status\` with run ID "${runId}" to monitor progress.`,
        },
      ],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error starting workflow: ${(err as Error).message}` }],
      isError: true,
    };
  }
}

async function handleGetRunStatus(
  input: z.infer<typeof getRunStatusSchema>
): Promise<ToolResult> {
  try {
    const detail = await persistence.getWorkflowRunWithDetails(input.runId);
    if (!detail) {
      return {
        content: [{ type: "text", text: `Error: Run '${input.runId}' not found.` }],
        isError: true,
      };
    }

    // Compute progress from steps
    const totalSteps = detail.steps?.length ?? 0;
    const completedSteps = detail.steps?.filter(
      (s) => s.status === "completed"
    ).length ?? 0;
    const progress =
      totalSteps > 0 ? `${completedSteps}/${totalSteps} steps` : "No steps yet";

    // Get last 5 events as logs, truncating large payloads
    const recentEvents = (detail.events ?? []).slice(-5).map((evt) => {
      let payload = evt.payload;
      if (payload && payload.length > 1024) {
        payload = payload.slice(0, 1024) + "... (truncated)";
      }
      return `[${evt.event_type}] ${payload ?? ""}`;
    });

    const parts = [
      `**Run ID**: ${detail.run.id}`,
      `**Status**: ${detail.run.status}`,
      `**Progress**: ${progress}`,
    ];

    if (detail.run.started_at) {
      parts.push(`**Started**: ${new Date(detail.run.started_at).toLocaleString()}`);
    }
    if (detail.run.completed_at) {
      parts.push(`**Completed**: ${new Date(detail.run.completed_at).toLocaleString()}`);
    }

    if (recentEvents.length > 0) {
      parts.push("", "**Recent logs:**");
      recentEvents.forEach((log) => parts.push(`  ${log}`));
    }

    // Build additional visual resources and surface them as plain data —
    // a live dashboard URL, a mermaid diagram of the flow state, and a
    // ready-to-use React component snippet. These are offered as
    // optional content for the user to request; no instructions to the
    // assistant are embedded in the tool output.
    let visualsSection = "";
    try {
      const schema = JSON.parse(
        detail.run.schema_json as unknown as string
      ) as WorkflowSchema;
      const mermaid = renderWorkflowMermaid(schema, detail.steps);
      const reactCode = renderRunAsReactArtifact(schema, {
        run: detail.run,
        steps: detail.steps,
      });

      const base = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
      const dashboardUrl = base ? `${base}/runs/${detail.run.id}` : null;

      const lines: string[] = ["", "---", "", "**Optional visuals**"];
      if (dashboardUrl) {
        lines.push(`- Live dashboard: ${dashboardUrl}`);
      }
      lines.push(
        "- A mermaid diagram and a React component snippet are included below. Both are data, not instructions. Render them only if the user explicitly asks for a visual view of this run."
      );
      lines.push("", "<details><summary>Mermaid flow state</summary>", "", "```mermaid", mermaid, "```", "</details>");
      lines.push(
        "",
        "<details><summary>React component (single file, Tailwind)</summary>",
        "",
        "```jsx",
        reactCode,
        "```",
        "</details>"
      );

      visualsSection = lines.join("\n");
    } catch (err) {
      console.warn("[mcp] visual rendering failed:", err);
    }

    return {
      content: [{ type: "text", text: parts.join("\n") + visualsSection }],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error getting run status: ${(err as Error).message}` }],
      isError: true,
    };
  }
}

async function handleListRuns(): Promise<ToolResult> {
  try {
    const allRuns = await persistence.listRuns(50);

    // Cap to 10 most recent — matches stdio behavior
    const runs = allRuns.slice(0, 10);

    if (runs.length === 0) {
      return { content: [{ type: "text", text: "No workflow runs found." }] };
    }

    const lines = runs.map(
      (r) =>
        `- **${r.workflow_name ?? r.workflow_id}** — Run \`${r.id}\` — Status: ${r.status} — ${new Date(r.created_at).toLocaleString()}`
    );

    return {
      content: [
        {
          type: "text",
          text: `Most recent ${runs.length} run(s):\n\n${lines.join("\n")}`,
        },
      ],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error listing runs: ${(err as Error).message}` }],
      isError: true,
    };
  }
}

async function handleCreateWorkflow(
  input: z.infer<typeof createWorkflowSchema>
): Promise<ToolResult> {
  try {
    // Auto-generate boilerplate — mirrors mcp/src/client.ts::createWorkflow
    const resolvedEntryNodeId =
      input.entryNodeId ??
      (input.nodes.length > 0 ? String(input.nodes[0].id ?? "node-0") : "node-0");

    const flowId = `wf-${Date.now().toString(36)}`;

    const schema = {
      schemaVersion: "1.0",
      id: flowId,
      name: input.name,
      entryNodeId: resolvedEntryNodeId,
      nodes: input.nodes,
      edges: input.edges,
    };

    // Validate the assembled schema
    const validation = validateWorkflowSchema(schema);
    if (!validation.valid) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Invalid workflow schema: ${validation.errors.join(", ")}`,
          },
        ],
        isError: true,
      };
    }

    // Normalize edge field names (source/target) — mirrors workflowRoutes.ts
    const normalizedSchema = { ...schema };
    if (Array.isArray(normalizedSchema.edges)) {
      normalizedSchema.edges = (normalizedSchema.edges as Array<Record<string, unknown>>).map(
        (edge) => ({
          ...edge,
          source: (edge as Record<string, unknown>).source ?? (edge as Record<string, unknown>).from,
          target: (edge as Record<string, unknown>).target ?? (edge as Record<string, unknown>).to,
        })
      );
    }

    const schemaJson = JSON.stringify(normalizedSchema);

    // Use the schema's id as the DB id — same as workflowRoutes.ts POST handler
    const id = flowId;
    await persistence.createWorkflow(id, input.name.trim(), schemaJson);

    return {
      content: [
        {
          type: "text",
          text: `Workflow created successfully!\n\n- **Name**: ${input.name}\n- **ID**: ${id}\n- **Version**: 1\n\nYou can now start this workflow using \`start_workflow\` with ID "${id}".`,
        },
      ],
    };
  } catch (err) {
    const message = (err as Error).message;
    // Handle duplicate ID
    if (message.includes("Unique constraint")) {
      return {
        content: [
          { type: "text", text: "Error: Workflow with this ID already exists. Please try again." },
        ],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: `Error creating workflow: ${message}` }],
      isError: true,
    };
  }
}

// ── MCP Server Factory ─────────────────────────────────────────────────

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "flow-manager", version: "1.0.0" });

  // ─── Tool: salesforce_concierge ────────────────────────────────────
  server.tool(
    "salesforce_concierge",
    "Talk to Salesforce in plain English. Preferred tool for ad-hoc Salesforce work: logging a new deal (with automatic web enrichment), asking pipeline questions, updating a record, posting to Chatter. Finds-or-creates records — users never paste IDs. Runs as a real wf-concierge workflow so every call is visible in Run History.",
    salesforceConciergeSchema.shape,
    async (input) => handleSalesforceConcierge(input)
  );


  // ─── Tool: list_workflows ──────────────────────────────────────────
  server.tool(
    "list_workflows",
    "List all saved workflows from the Flow Manager. Returns workflow names and IDs.",
    listWorkflowsSchema.shape,
    async () => handleListWorkflows()
  );

  // ─── Tool: describe_workflow ───────────────────────────────────────
  server.tool(
    "describe_workflow",
    "Describe a workflow in human terms: what it does, what inputs it needs (with descriptions and example values), and what steps it runs. Call this BEFORE start_workflow so you can collect inputs from the user conversationally instead of demanding JSON.",
    describeWorkflowSchema.shape,
    async (input) => handleDescribeWorkflow(input)
  );

  // ─── Tool: start_workflow ──────────────────────────────────────────
  server.tool(
    "start_workflow",
    "Start a workflow run. Requires the workflow ID and (usually) input data. Best practice: call describe_workflow first to learn what inputs the workflow needs, then gather those values from the user in natural conversation — don't ask the user to provide JSON.",
    startWorkflowSchema.shape,
    async (input) => handleStartWorkflow(input)
  );

  // ─── Tool: get_run_status ──────────────────────────────────────────
  server.tool(
    "get_run_status",
    "Get the status, progress, and recent logs for a workflow run.",
    getRunStatusSchema.shape,
    async (input) => handleGetRunStatus(input)
  );

  // ─── Tool: list_runs ──────────────────────────────────────────────
  server.tool(
    "list_runs",
    "List the 10 most recent workflow runs with their status.",
    listRunsSchema.shape,
    async () => handleListRuns()
  );

  // ─── Tool: create_workflow ─────────────────────────────────────────
  server.tool(
    "create_workflow",
    "Assemble and publish a new workflow definition (nodes + edges). Use this when the user asks to 'create a flow' or 'build a workflow' that should be reusable. After creation, the workflow is immediately visible in Run History / the flow editor and callable via start_workflow by its returned ID. Best practice: after creating, offer to start the run immediately. See the `nodes` parameter description for the full shape of agent nodes (MCP servers, tools, skills, model/effort, etc.) and the catalog of known MCP URLs.",
    createWorkflowSchema.shape,
    async (input) => handleCreateWorkflow(input)
  );

  console.log("[mcp-http] McpServer created with 7 tools (direct service layer)");

  return server;
}

// ── Express Handler ────────────────────────────────────────────────────

/**
 * Stateless Streamable-HTTP handler.
 *
 * Creates a fresh McpServer + StreamableHTTPServerTransport per request.
 * This matches the MCP SDK "Without Session Management (Stateless)" example.
 * Safe because tool registration is cheap and stateless requests have no
 * cross-request state to preserve.
 */
export async function mcpHttpHandler(req: Request, res: Response): Promise<void> {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — no session tracking
    enableJsonResponse: true,      // Express already parsed JSON body
  });

  // Prevent leaks if client aborts
  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[mcpHttpHandler] error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal MCP error" },
        id: null,
      });
    }
  }
}
