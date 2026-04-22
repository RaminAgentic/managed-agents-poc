/**
 * MCP Tool: list_workflows
 * Lists all saved workflows from the Flow Manager backend.
 */
import { z } from "zod";
import { listWorkflows } from "../client.js";

export const listWorkflowsSchema = z.object({});

export async function listWorkflowsHandler(
  _input: z.infer<typeof listWorkflowsSchema>
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const workflows = await listWorkflows();

    if (workflows.length === 0) {
      return {
        content: [{ type: "text", text: "No workflows found." }],
      };
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
