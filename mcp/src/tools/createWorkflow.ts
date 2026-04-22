/**
 * MCP Tool: create_workflow
 * Creates a new workflow definition in the Flow Manager backend.
 *
 * Note: The backend expects a full schema with schemaVersion, flowId, name,
 * entryNodeId, nodes[], and edges[]. This tool accepts simplified inputs and
 * auto-generates the boilerplate fields.
 *
 * Valid node types: input, agent, human_gate, finalize.
 * Each workflow must have exactly one 'finalize' node.
 * Agent nodes must have config.instructions (non-empty string).
 */
import { z } from "zod";
import { createWorkflow } from "../client.js";

const AGENT_NODE_GUIDE = `
Each workflow node is one of:
  - input:      { id, type: 'input', name, config: { requiredFields?: string[] } }
  - agent:      { id, type: 'agent', name, config: <AgentNodeConfig>, modelConfig?: { model?, effort? } }
  - human_gate: { id, type: 'human_gate', name, config: { channel, messageTemplate, decisionValues: string[] } }
  - finalize:   { id, type: 'finalize', name, config: { summaryFields?: string[] } }

AgentNodeConfig shape (agents are Managed Agents — configured once here, executed per run):
  {
    instructions: string,
    inputMapping?: { [varName]: "$.run.input.<field>" | "$.steps.<nodeId>.outputs.<field>" },
    timeoutSeconds?: number,
    outputFormat?: "text" | "json",
    mcpServers?: [{ name, type: "url", url }],
    tools?: [
      { type: "agent_toolset_20260401" },
      { type: "mcp_toolset", mcp_server_name: "<name from mcpServers>",
        default_config: { permission_policy: { type: "always_allow" } } }
    ],
    skills?: [{ type: "anthropic", skill_id: "docx" }]
  }

Known remote MCP servers (use these exact URLs):
  - Slack:      https://mcp.slack.com/mcp
  - Salesforce: https://mcp.salesforce.com/mcp
  - Linear:     https://mcp.linear.app/mcp
  - Sentry:     https://mcp.sentry.dev/mcp
  - Notion:     https://mcp.notion.com/mcp
  - GitHub:     https://api.githubcopilot.com/mcp/
  - Atlassian:  https://mcp.atlassian.com/v1/sse

Known Anthropic skills: "docx", "xlsx", "pdf", "pptx".

Rules:
- Exactly one finalize node per workflow.
- Edges: { from: <nodeId>, to: <nodeId> }.
- Agent instructions should be detailed system prompts.
`.trim();

export const createWorkflowSchema = z.object({
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

export async function createWorkflowHandler(
  input: z.infer<typeof createWorkflowSchema>
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const result = await createWorkflow(
      input.name,
      input.nodes,
      input.edges,
      input.entryNodeId
    );

    return {
      content: [
        {
          type: "text",
          text: `Workflow created successfully!\n\n- **Name**: ${result.name}\n- **ID**: ${result.id}\n- **Version**: ${result.version}\n\nYou can now start this workflow using \`start_workflow\` with ID "${result.id}".`,
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        { type: "text", text: `Error creating workflow: ${(err as Error).message}` },
      ],
      isError: true,
    };
  }
}
