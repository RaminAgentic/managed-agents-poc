# Project Instructions

Read `PROJECT.md` in this directory for complete project context.
All project plan artifacts are in `docs/project-plan/`.

### Claude Code MCP Integration

A standalone MCP server lives in `mcp/` that lets Claude Code interact with the Flow Manager via 5 tools: `list_workflows`, `start_workflow`, `get_run_status`, `list_runs`, and `create_workflow`. See [`mcp/README.md`](mcp/README.md) for setup and usage instructions.
