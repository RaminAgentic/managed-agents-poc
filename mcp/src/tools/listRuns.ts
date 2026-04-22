/**
 * MCP Tool: list_runs
 * Lists the 10 most recent workflow runs.
 */
import { z } from "zod";
import { listRuns } from "../client.js";

export const listRunsSchema = z.object({});

export async function listRunsHandler(
  _input: z.infer<typeof listRunsSchema>
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const allRuns = await listRuns();

    // Backend returns up to 50, cap to 10 most recent
    const runs = allRuns.slice(0, 10);

    if (runs.length === 0) {
      return {
        content: [{ type: "text", text: "No workflow runs found." }],
      };
    }

    const lines = runs.map(
      (r) =>
        `- **${r.workflowName ?? r.workflowId}** — Run \`${r.id}\` — Status: ${r.status} — ${new Date(r.createdAt).toLocaleString()}`
    );

    return {
      content: [
        {
          type: "text",
          text: `Most recent ${runs.length} run(s):\n\n${lines.join("\n")}`,
        },
      ],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error listing runs: ${(err as Error).message}` }],
      isError: true,
    };
  }
}
