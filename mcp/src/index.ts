#!/usr/bin/env node
/**
 * Flow Manager MCP Server — Entry Point
 *
 * Connects the MCP server to Claude Code via stdio JSON-RPC transport.
 * All logging goes to stderr to avoid corrupting the stdio protocol.
 *
 * Usage:
 *   node dist/index.js          # production (after build)
 *   npx tsx src/index.ts        # development
 *
 * Environment variables:
 *   FLOW_MANAGER_URL  — Base URL for the Flow Manager backend
 *                       (default: http://localhost:5001)
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();

  console.error("[flow-manager-mcp] Starting stdio transport...");

  await server.connect(transport);

  console.error("[flow-manager-mcp] MCP server listening on stdio.");
}

main().catch((err) => {
  console.error("[flow-manager-mcp] Fatal error:", err);
  process.exit(1);
});
