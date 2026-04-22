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

export const createWorkflowSchema = z.object({
  name: z.string().min(1).describe("Name of the workflow"),
  nodes: z
    .array(z.record(z.unknown()))
    .describe(
      "Array of workflow node objects. Each node needs: { id: string, type: 'input'|'agent'|'human_gate'|'finalize', name: string }. Agent nodes also need: { config: { instructions: string } }. Must include exactly one 'finalize' node."
    ),
  edges: z
    .array(z.record(z.unknown()))
    .describe(
      "Array of workflow edge objects. Each edge needs: { from: string, to: string } (node IDs)."
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
