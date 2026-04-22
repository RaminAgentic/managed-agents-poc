/**
 * MCP Tool: start_workflow
 * Starts a workflow run by posting to the Flow Manager backend.
 */
import { z } from "zod";
import { startRun } from "../client.js";

export const startWorkflowSchema = z.object({
  workflowId: z.string().min(1).describe("The ID of the workflow to start"),
  input: z
    .record(z.unknown())
    .optional()
    .default({})
    .describe("Optional input data for the workflow run"),
});

export async function startWorkflowHandler(
  input: z.infer<typeof startWorkflowSchema>
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const result = await startRun(input.workflowId, input.input);

    return {
      content: [
        {
          type: "text",
          text: `Workflow run started successfully!\n\n- **Run ID**: ${result.runId}\n- **Status**: ${result.status}\n\nUse \`get_run_status\` with run ID "${result.runId}" to monitor progress.`,
        },
      ],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error starting workflow: ${(err as Error).message}` }],
      isError: true,
    };
  }
}
