# Sprint Plan

11 sprints planned

## Sprint 1: Project Scaffolding & Claude SDK Setup [planned]
Initialize the project (Node.js/TypeScript), install the Anthropic SDK, configure environment variables for the API key, and create a minimal data layer with hardcoded sample prompts/tools and a simple conversation state module to feed the managed agent.

**Tasks:**
- Initialize Node.js/TypeScript project with Anthropic SDK (completed)
- Configure environment variables and Anthropic client module (completed)
- Create hardcoded sample prompts and system instructions (completed)
- Define sample tool schemas for the managed agent (completed)
- Implement conversation state module (completed)

## Sprint 2: Managed Agent Core Loop & CLI Interface [planned]
Implement the bare-bones managed agent following the quickstart docs — wire up a single agent invocation with one example tool, run the agent loop end-to-end, and expose it through a simple CLI that accepts a user prompt and prints the agent response.

**Tasks:**
- Implement tool dispatcher for agent tool_use blocks (completed)
- Implement managed agent loop with Anthropic Messages API (completed)
- Create CLI entrypoint accepting a user prompt (completed)
- Add verbose turn-by-turn logging to the agent loop (completed)

## Sprint 3: Multi-Agent Orchestration Flow [planned]
Introduce a second specialized sub-agent and an orchestrator that routes tasks between them. Builds on the single-agent loop from Sprint 2 to demonstrate Claude-to-Claude delegation using the Anthropic SDK.

**Tasks:**
- Define a second specialized agent (research agent) (completed)
- Build the orchestrator agent (completed)
- Update CLI entrypoint to use the orchestrator (completed)
- Add orchestrator-level logging (completed)

## Sprint 4: Convert CLI to Web App [planned]
Replace the CLI entrypoint with an Express web server serving a chat-style browser UI on port 5002. Users interact with the orchestrator through a web page instead of the terminal. Keep all existing agent logic (orchestrator, weather agent, research agent) intact — only change the I/O layer from CLI to HTTP/HTML.

**Tasks:**
- Add Express server with API endpoint (completed)
- Create browser chat UI (completed)
- Add sample prompt buttons to the UI (completed)
- Add agent routing indicator to responses (completed)

## Sprint 4: Web App UI [planned]
Convert the CLI POC into a proper web app. Add an Express server that exposes the orchestrator as a REST API, and build a React + MUI chat interface on the frontend so users can type prompts and see agent responses in the browser at port 5002.

**Tasks:**
- Add Express API server with /api/chat endpoint (completed)
- Create React + MUI frontend (completed)
- Configure Vite proxy and update dev scripts (completed)
- Display agent routing trace in the UI (completed)

## Sprint 6: Database & API Foundation [planned]
Set up a SQLite database with the full workflow schema (workflows, workflow_runs, run_steps, run_events, approvals), wire up REST API endpoints for workflow and run management, and implement a JSON schema validator that enforces node/edge rules before execution.

**Tasks:**
- Install and configure SQLite with Prisma (completed)
- Build /workflows REST endpoints (completed)
- Build /runs REST endpoints (completed)
- Implement JSON schema validator (completed)
- Add error handling middleware and CORS (completed)

## Sprint 7: React Flow Visual Workflow Editor [planned]
Build the visual workflow designer using @xyflow/react. Users can drag and drop 4 node types onto a canvas, connect them with edges, configure node properties in an inspector panel, and save/load workflows to/from the API as the JSON schema format.

**Tasks:**
- Install React Flow and scaffold the editor page (completed)
- Implement 4 custom node types (completed)
- Build the node inspector panel (completed)
- Implement workflow serialization and save/load (completed)
- Add a Run button and input collection modal (completed)

## Sprint 8: Workflow Orchestrator Engine [planned]
Implement the server-side workflow execution engine that reads a saved workflow JSON schema, walks the node graph, executes Claude Managed Agent nodes using claude-opus-4-7, resolves inputMapping expressions, persists every step and event to the database, and updates run status throughout.

**Tasks:**
- Implement the core executeWorkflow function (completed)
- Implement agent node execution with Claude Managed Agents (completed)
- Implement input and finalize node handlers (completed)
- Persist run steps and events throughout execution (completed)
- Wire executor into the POST /runs endpoint (completed)

## Sprint 9: Run History & Monitoring UI [planned]
Build the run monitoring experience in the React frontend. Users can browse all workflow runs, open a run detail view showing each step's status and output, and watch an active run update in near-real-time via polling. This closes the loop from clicking Run in the editor to seeing agent outputs.

**Tasks:**
- Build the Run List page (completed)
- Build the Run Detail page with step timeline (completed)
- Show agent output content in step detail (completed)
- Add navigation between editor and runs (completed)

## Fix: Sprint 7: React Flow Visual Workflow Editor [planned]
Auto-created to address 1 critical/high priority issue(s) from code review

**Tasks:**
- Fix: Re-saving a workflow fails with 409 Conflict (completed)

## Sprint 11: MCP Server — Claude Code Integration [planned]
Build a standalone MCP server that connects Claude Code to the flow manager web app. Exposes tools for listing workflows, starting runs, checking run status, and optionally creating workflows. Registers via stdio with Claude Code using `claude mcp add`.
