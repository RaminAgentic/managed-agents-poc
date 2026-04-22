/**
 * MCP Server — registers all tools with the McpServer instance.
 *
 * WARNING: Never use console.log anywhere in this package.
 * The MCP protocol uses stdio for JSON-RPC; stdout writes corrupt the stream.
 * All logging MUST go to console.error (stderr).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listWorkflowsSchema, listWorkflowsHandler } from "./tools/listWorkflows.js";
import { startWorkflowSchema, startWorkflowHandler } from "./tools/startWorkflow.js";
import { getRunStatusSchema, getRunStatusHandler } from "./tools/getRunStatus.js";
import { listRunsSchema, listRunsHandler } from "./tools/listRuns.js";
import { createWorkflowSchema, createWorkflowHandler } from "./tools/createWorkflow.js";
import { getBaseUrl } from "./client.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "flow-manager-mcp",
    version: "1.0.0",
  });

  // ─── Tool: list_workflows ──────────────────────────────────────────
  server.tool(
    "list_workflows",
    "List all saved workflows from the Flow Manager. Returns workflow names and IDs.",
    listWorkflowsSchema.shape,
    async (input) => listWorkflowsHandler(input)
  );

  // ─── Tool: start_workflow ──────────────────────────────────────────
  server.tool(
    "start_workflow",
    "Start a workflow run. Requires the workflow ID and optional input data. Returns the new run ID.",
    startWorkflowSchema.shape,
    async (input) => startWorkflowHandler(input)
  );

  // ─── Tool: get_run_status ──────────────────────────────────────────
  server.tool(
    "get_run_status",
    "Get the status, progress, and recent logs for a workflow run.",
    getRunStatusSchema.shape,
    async (input) => getRunStatusHandler(input)
  );

  // ─── Tool: list_runs ──────────────────────────────────────────────
  server.tool(
    "list_runs",
    "List the 10 most recent workflow runs with their status.",
    listRunsSchema.shape,
    async (input) => listRunsHandler(input)
  );

  // ─── Tool: create_workflow ─────────────────────────────────────────
  server.tool(
    "create_workflow",
    "Create a new workflow definition with a name, nodes, and edges. The tool handles wrapping into the correct schema format.",
    createWorkflowSchema.shape,
    async (input) => createWorkflowHandler(input)
  );

  console.error(
    `[flow-manager-mcp] Server created with 5 tools. Backend URL: ${getBaseUrl()}`
  );

  return server;
}
