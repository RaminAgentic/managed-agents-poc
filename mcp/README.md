# Flow Manager MCP Server

An MCP (Model Context Protocol) server that bridges **Claude Code** (CLI) with the Flow Manager web app. It exposes workflow management tools over stdio JSON-RPC, letting Claude Code list, create, and run workflows directly.

## Prerequisites

- **Node.js 18+**
- Flow Manager backend running (default: `http://localhost:5001`)

## Install & Build

```bash
cd mcp
npm install
npm run build
```

## Register with Claude Code

```bash
# From the project root — registers the MCP server as a stdio subprocess
claude mcp add flow-manager -- node mcp/dist/index.js
```

To set a custom backend URL:

```bash
claude mcp add flow-manager \
  --env FLOW_MANAGER_URL=http://localhost:5001 \
  -- node mcp/dist/index.js
```

Verify registration:

```bash
claude mcp list
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `FLOW_MANAGER_URL` | `http://localhost:5001` | Base URL for the Flow Manager backend API |

## Available Tools

| Tool | Description | Inputs |
|---|---|---|
| `list_workflows` | List all saved workflows | _(none)_ |
| `start_workflow` | Start a workflow run | `workflowId` (string), `input` (object, optional) |
| `get_run_status` | Get run status, progress, and recent logs | `runId` (string) |
| `list_runs` | List the 10 most recent workflow runs | _(none)_ |
| `create_workflow` | Create a new workflow definition | `name` (string), `nodes` (array), `edges` (array), `entryNodeId` (string, optional) |

### Node Types

When creating workflows, valid node types are: `input`, `agent`, `human_gate`, `finalize`.

- Every workflow must have exactly one `finalize` node
- `agent` nodes require `config.instructions` (non-empty string)
- The `entryNodeId` defaults to the first node's ID if not specified

## Example Claude Code Prompts

Once registered, you can use these prompts in Claude Code:

- **"List all saved workflows"** — triggers `list_workflows`
- **"Start the 'research-pipeline' workflow with input {topic: 'ocean currents'}"** — triggers `start_workflow`
- **"What's the status of run cmoa2algf0001sb89r2mxbuy6?"** — triggers `get_run_status`
- **"Show the last 10 workflow runs"** — triggers `list_runs`
- **"Create a new workflow named 'research' with an input node, an agent node that summarizes topics, and a finalize node"** — triggers `create_workflow`

## Development

```bash
# Run directly with tsx (no build step)
npm run dev

# Build TypeScript to dist/
npm run build

# Run built version
npm start
```

## Troubleshooting

1. **`claude mcp list` doesn't show flow-manager** — Re-run the `claude mcp add` command from the project root.

2. **Tools return "Flow Manager not reachable"** — Make sure the backend is running:
   ```bash
   npm run server   # from project root
   ```

3. **Stderr logs** — The MCP server logs to stderr (never stdout, which would corrupt the JSON-RPC protocol). Check Claude Code's MCP logs for debugging output.

4. **Schema validation errors on create_workflow** — Ensure your nodes have `id`, `type`, and `name` fields. Agent nodes need `config.instructions`. Include exactly one `finalize` node.

5. **Port mismatch** — The backend runs on port 5001 in dev mode and 5002 in production. Set `FLOW_MANAGER_URL` accordingly.
