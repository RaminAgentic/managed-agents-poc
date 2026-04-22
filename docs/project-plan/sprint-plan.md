# Sprint Plan

2 sprints planned

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
- Implement tool dispatcher for agent tool_use blocks (pending)
- Implement managed agent loop with Anthropic Messages API (pending)
- Create CLI entrypoint accepting a user prompt (pending)
- Add verbose turn-by-turn logging to the agent loop (pending)
