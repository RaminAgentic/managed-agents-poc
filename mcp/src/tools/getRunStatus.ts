/**
 * MCP Tool: get_run_status
 * Gets the status, progress, and recent logs for a workflow run.
 */
import { z } from "zod";
import { getRunDetail } from "../client.js";

export const getRunStatusSchema = z.object({
  runId: z.string().min(1).describe("The ID of the workflow run to check"),
});

export async function getRunStatusHandler(
  input: z.infer<typeof getRunStatusSchema>
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const detail = await getRunDetail(input.runId);

    // Compute progress from steps
    const totalSteps = detail.steps?.length ?? 0;
    const completedSteps = detail.steps?.filter(
      (s) => s.status === "completed"
    ).length ?? 0;
    const progress =
      totalSteps > 0 ? `${completedSteps}/${totalSteps} steps` : "No steps yet";

    // Get last 5 events as logs, truncating large payloads
    const recentEvents = (detail.events ?? []).slice(-5).map((evt) => {
      let payload = evt.payload_json;
      if (payload && payload.length > 1024) {
        payload = payload.slice(0, 1024) + "... (truncated)";
      }
      return `[${evt.type}] ${payload ?? ""}`;
    });

    const parts = [
      `**Run ID**: ${detail.id}`,
      `**Status**: ${detail.status}`,
      `**Progress**: ${progress}`,
    ];

    if (detail.started_at) {
      parts.push(`**Started**: ${new Date(detail.started_at).toLocaleString()}`);
    }
    if (detail.completed_at) {
      parts.push(
        `**Completed**: ${new Date(detail.completed_at).toLocaleString()}`
      );
    }

    if (recentEvents.length > 0) {
      parts.push("", "**Recent logs:**");
      recentEvents.forEach((log) => parts.push(`  ${log}`));
    }

    return {
      content: [{ type: "text", text: parts.join("\n") }],
    };
  } catch (err) {
    return {
      content: [
        { type: "text", text: `Error getting run status: ${(err as Error).message}` },
      ],
      isError: true,
    };
  }
}
