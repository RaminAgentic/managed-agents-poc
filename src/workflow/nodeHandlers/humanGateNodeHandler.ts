/**
 * Human Gate Node Handler — Slack-based approval with durable polling.
 *
 * Flow:
 *   1. Resolve the message template against the run context.
 *   2. Post a Block Kit message to Slack with buttons that are plain URL
 *      links back to our approval endpoint (GET /api/approval/:stepId?d=...).
 *      This avoids needing Slack's interactivity webhook configured.
 *   3. Create an Approval row tied to this step.
 *   4. Poll the Approval row every 5 seconds until it's resolved or the
 *      configured timeout elapses.
 *   5. Return the decision as the step's output, with a `chosenEdgeLabels`
 *      array so the executor routes based on the decision value.
 *
 * Env:
 *   SLACK_BOT_TOKEN          — OAuth bot token with chat:write scope
 *   PUBLIC_BASE_URL          — e.g. https://managed-agents-poc.onrender.com
 *                              (used to build approval callback links)
 *
 * If SLACK_BOT_TOKEN is unset, posting is skipped with a warning and the
 * handler just polls the Approval row — an operator can POST to the
 * approval endpoint manually. Useful for local dev.
 */
import prisma from "../../db/client";
import type {
  WorkflowNode,
  RunContext,
  HandlerOptions,
  StepResult,
  HumanGateNodeConfig,
} from "../types";
import { substituteTemplate } from "../resolveInputMapping";

const DEFAULT_TIMEOUT_SECONDS = 600;
const POLL_INTERVAL_MS = 5_000;

function buildCallbackUrl(stepId: string, decision: string): string {
  const base = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
  const path = `/api/approval/${stepId}?d=${encodeURIComponent(decision)}`;
  return base ? `${base}${path}` : path;
}

function iconEmoji(icon: string): string {
  const map: Record<string, string> = {
    "red-stapler": "red_circle",
    "flair-buttons": "bust_in_silhouette",
    lumbergh: "coffee",
    milton: "red_circle",
    livingston: "briefcase",
  };
  return map[icon] ?? "bell";
}

async function postToSlack(
  channel: string,
  text: string,
  stepId: string,
  decisionValues: string[],
  approver?: string,
  icon?: string
): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.warn(
      "[humanGate] SLACK_BOT_TOKEN unset — skipping Slack post. Approval can still be resolved via /api/approval/:stepId."
    );
    return;
  }

  const headerText =
    (icon ? `:${iconEmoji(icon)}: ` : "") +
    (approver ? `*Approval needed: ${approver}*\n` : "") +
    text;

  const buttons = decisionValues.map((d) => {
    const norm = d.toLowerCase();
    return {
      type: "button",
      text: { type: "plain_text", text: d, emoji: true },
      url: buildCallbackUrl(stepId, d),
      style: norm.match(/approv|yes|ok|sign/)
        ? "primary"
        : norm.match(/rej|no|deny/)
          ? "danger"
          : undefined,
    };
  });

  const payload = {
    channel,
    text: headerText,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: headerText } },
      { type: "actions", elements: buttons },
    ],
  };

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
    throw new Error(`Slack postMessage failed: ${body.error ?? "unknown"}`);
  }
}

export async function runHumanGateNode(
  node: WorkflowNode,
  ctx: RunContext,
  opts: HandlerOptions
): Promise<StepResult> {
  const config = node.config as HumanGateNodeConfig;

  if (
    !Array.isArray(config.decisionValues) ||
    config.decisionValues.length === 0
  ) {
    throw new Error(
      `Human gate node "${node.id}" needs at least one decisionValue`
    );
  }

  // Build the message — allow {{input.*}} and {{steps.<nodeId>.<field>}} refs
  const fullScope: Record<string, unknown> = {
    input: ctx.run.input,
    steps: Object.fromEntries(
      Object.entries(ctx.steps).map(([k, v]) => [k, v.outputs])
    ),
  };
  const message = substituteTemplate(config.messageTemplate ?? "", fullScope);

  // Create the Approval row
  const approval = await prisma.approval.create({
    data: {
      stepId: opts.stepId,
      slackChannel: config.channel || null,
      decision: "pending",
    },
  });
  console.log(
    `[humanGate] ${node.id} — approval ${approval.id} pending, approver=${config.approver ?? "(any)"}`
  );

  // Post to Slack (best-effort — don't fail the step if Slack is down)
  if (config.channel) {
    try {
      await postToSlack(
        config.channel,
        message,
        opts.stepId,
        config.decisionValues,
        config.approver,
        config.icon
      );
    } catch (err) {
      console.error(`[humanGate] Slack post failed:`, err);
    }
  }

  // Poll until resolved or timeout
  const timeoutSeconds = config.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    const current = await prisma.approval.findUnique({
      where: { id: approval.id },
    });
    if (current && current.decision && current.decision !== "pending") {
      console.log(
        `[humanGate] ${node.id} — resolved: ${current.decision}`
      );
      return {
        outputs: {
          decision: current.decision,
          comment: current.comment ?? null,
          approvedBy: current.slackUserId ?? null,
          chosenEdgeLabels: [current.decision],
        },
      };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(
    `Human gate "${node.id}" timed out after ${timeoutSeconds}s (approval ${approval.id} never resolved)`
  );
}
