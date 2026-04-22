/**
 * Finalize Node Handler
 *
 * Marks the run as completed and produces a summary of all step outputs.
 * Optionally posts a rich Block Kit summary to Slack so the whole run's
 * progression is visible in-channel (useful when the workflow was
 * triggered by a human and they want to see the outcome at a glance).
 */
import type {
  WorkflowNode,
  RunContext,
  HandlerOptions,
  StepResult,
  FinalizeNodeConfig,
  WorkflowSchema,
} from "../types";
import {
  updateRunStatus,
  logEvent,
  getWorkflow,
  getRunSteps,
} from "../persistence";
import { substituteTemplate } from "../resolveInputMapping";
import { renderWorkflowMermaid } from "../renderMermaid";

function stepEmoji(status: string): string {
  switch (status) {
    case "completed":
      return ":white_check_mark:";
    case "failed":
      return ":x:";
    case "running":
      return ":hourglass_flowing_sand:";
    case "awaiting_approval":
      return ":raised_hand:";
    default:
      return ":black_circle:";
  }
}

function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return "";
  const seconds = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000;
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${(seconds / 60).toFixed(1)}m`;
}

async function postRunSummaryToSlack(params: {
  channel: string;
  title: string;
  runId: string;
  workflowName: string;
  steps: Array<{
    nodeId: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
  }>;
  publicBaseUrl?: string;
  mermaid?: string;
}): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.warn(
      "[finalize] SLACK_BOT_TOKEN unset — skipping Slack summary post."
    );
    return;
  }

  const stepLines = params.steps.map((s) => {
    const dur = formatDuration(s.startedAt, s.completedAt);
    return `${stepEmoji(s.status)}  \`${s.nodeId}\`${dur ? ` — _${dur}_` : ""}`;
  });

  const runLink = params.publicBaseUrl
    ? `${params.publicBaseUrl.replace(/\/+$/, "")}/runs/${params.runId}`
    : null;

  const headerText = `:checkered_flag: *${params.title}*\nWorkflow: *${params.workflowName}* · Run \`${params.runId.slice(0, 10)}\``;

  const blocks: Array<Record<string, unknown>> = [
    { type: "section", text: { type: "mrkdwn", text: headerText } },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: stepLines.join("\n") || "_(no steps recorded)_",
      },
    },
  ];

  if (runLink) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `<${runLink}|Open run in dashboard>`,
        },
      ],
    });
  }

  if (params.mermaid) {
    const mermaidLiveUrl =
      "https://mermaid.live/edit#base64:" +
      Buffer.from(
        JSON.stringify({
          code: params.mermaid,
          mermaid: { theme: "default" },
        })
      ).toString("base64");
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `<${mermaidLiveUrl}|View flow diagram> · agents coordinated by Managed Agents`,
        },
      ],
    });
  }

  const payload = {
    channel: params.channel,
    text: headerText,
    blocks,
  };

  try {
    const resp = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const body = (await resp.json()) as { ok: boolean; error?: string };
    if (!body.ok) {
      console.error(
        `[finalize] Slack postMessage failed: ${body.error ?? "unknown"}`
      );
    }
  } catch (err) {
    console.error("[finalize] Slack fetch failed:", err);
  }
}

export async function runFinalizeNode(
  node: WorkflowNode,
  ctx: RunContext,
  opts: HandlerOptions
): Promise<StepResult> {
  const config = (node.config ?? {}) as FinalizeNodeConfig;

  // Aggregate all step outputs into a summary
  const summary: Record<string, unknown> = {};
  for (const [stepNodeId, stepResult] of Object.entries(ctx.steps)) {
    summary[stepNodeId] = stepResult.outputs;
  }

  // Mark the run as completed
  await updateRunStatus(opts.runId, "completed");

  // Log the workflow_completed event with full summary
  await logEvent(opts.runId, opts.stepId, "workflow_completed", { summary });

  // Optional: post a rich Block Kit summary to Slack
  if (config.slackChannel) {
    try {
      const workflow = await getWorkflow(ctx.workflowId);
      const steps = await getRunSteps(opts.runId);

      const scope: Record<string, unknown> = {
        input: ctx.run.input,
        steps: Object.fromEntries(
          Object.entries(ctx.steps).map(([k, v]) => [k, v.outputs])
        ),
      };
      const title = substituteTemplate(
        config.slackTitle ?? "Run finished",
        scope
      );

      let mermaid: string | undefined;
      if (workflow) {
        try {
          const schema = JSON.parse(workflow.schema_json) as WorkflowSchema;
          mermaid = renderWorkflowMermaid(schema, steps);
        } catch {
          // non-fatal
        }
      }

      await postRunSummaryToSlack({
        channel: config.slackChannel,
        title,
        runId: opts.runId,
        workflowName: workflow?.name ?? ctx.workflowId,
        steps: steps.map((s) => ({
          nodeId: s.node_id,
          status: s.status,
          startedAt: s.started_at,
          completedAt: s.completed_at,
        })),
        publicBaseUrl: process.env.PUBLIC_BASE_URL,
        mermaid,
      });
    } catch (err) {
      console.error("[finalize] Slack summary post failed:", err);
    }
  }

  return {
    outputs: summary,
  };
}
