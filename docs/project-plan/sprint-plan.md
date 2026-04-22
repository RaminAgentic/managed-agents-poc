# Sprint Plan

5 sprints planned

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
- Add Express API server with /api/chat endpoint (pending)
- Create React + MUI frontend (pending)
- Configure Vite proxy and update dev scripts (pending)
- Display agent routing trace in the UI (pending)
