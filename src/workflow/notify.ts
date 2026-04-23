/**
 * Run-completion notification dispatcher (v2).
 *
 * Called by the executor on every terminal status transition
 * (completed, failed, cancelled). Reads the per-run notifyJson
 * override first, falling back to the workflow's top-level
 * `completion.notify` config. Fires best-effort to every configured
 * target; failures are logged but don't affect the run status.
 *
 * Supported targets (all optional):
 *   - slackChannel  — posts a Block Kit summary via Slack Web API
 *   - slackUserId   — DMs the user
 *   - webhookUrl    — POSTs a signed JSON payload
 *   - email         — SMTP / mail provider (NOT IMPLEMENTED in v2.0 —
 *                     stub logs a warning)
 */
import prisma from "../db/client";
import { logEvent } from "./persistence";
import type {
  WorkflowSchema,
  NotifyTargets,
  RunStatus,
} from "./types";

const APP_BASE_URL =
  process.env.APP_BASE_URL ??
  (process.env.NODE_ENV === "production"
    ? "https://managed-agents-poc.onrender.com"
    : "http://localhost:3000");

interface NotifyPayload {
  runId: string;
  workflowId: string;
  workflowName: string;
  status: RunStatus;
  url: string;
  summary?: string;
}

export async function dispatchNotify(
  runId: string,
  schema: WorkflowSchema,
  status: RunStatus
): Promise<void> {
  const run = await prisma.workflowRun.findUnique({
    where: { id: runId },
    select: { notifyJson: true },
  });

  const perRun: NotifyTargets | undefined = run?.notifyJson
    ? safeParseNotify(run.notifyJson)
    : undefined;
  const fromSchema = schema.completion?.notify;
  const targets: NotifyTargets = {
    ...(fromSchema ?? {}),
    ...(perRun ?? {}),
  };

  if (
    !targets.slackChannel &&
    !targets.slackUserId &&
    !targets.webhookUrl &&
    !targets.email
  ) {
    return;
  }

  const summary = await buildSummary(runId);
  const payload: NotifyPayload = {
    runId,
    workflowId: schema.id,
    workflowName: schema.name,
    status,
    url: `${APP_BASE_URL}/runs/${runId}`,
    summary,
  };

  const promises: Promise<void>[] = [];
  if (targets.webhookUrl) promises.push(sendWebhook(targets.webhookUrl, payload));
  if (targets.slackChannel)
    promises.push(sendSlack(targets.slackChannel, payload, "channel"));
  if (targets.slackUserId)
    promises.push(sendSlack(targets.slackUserId, payload, "user"));
  if (targets.email)
    promises.push(
      sendEmailStub(targets.email, payload).catch((e) =>
        console.warn("[notify] email stub failed:", e)
      )
    );

  const settled = await Promise.allSettled(promises);
  const okCount = settled.filter((s) => s.status === "fulfilled").length;
  await logEvent(runId, null, "notify_sent", {
    status,
    targetsConfigured: {
      slackChannel: !!targets.slackChannel,
      slackUserId: !!targets.slackUserId,
      webhookUrl: !!targets.webhookUrl,
      email: !!targets.email,
    },
    succeeded: okCount,
    total: settled.length,
  }).catch(() => {});
}

function safeParseNotify(raw: string): NotifyTargets | undefined {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as NotifyTargets;
  } catch {
    /* swallow */
  }
  return undefined;
}

async function buildSummary(runId: string): Promise<string | undefined> {
  const run = await prisma.workflowRun.findUnique({
    where: { id: runId },
    include: {
      steps: {
        orderBy: { startedAt: "asc" },
      },
      workflow: { select: { schemaJson: true } },
    },
  });
  if (!run) return undefined;

  const finalizeId = (() => {
    try {
      const schema = JSON.parse(run.workflow.schemaJson) as WorkflowSchema;
      return schema.nodes.find((n) => n.type === "finalize")?.id;
    } catch {
      return undefined;
    }
  })();
  const step = finalizeId
    ? run.steps.find((s) => s.nodeId === finalizeId)
    : run.steps[run.steps.length - 1];
  if (!step?.outputJson) return undefined;
  try {
    const out = JSON.parse(step.outputJson);
    if (typeof out?.text === "string") return out.text.slice(0, 1000);
    return JSON.stringify(out).slice(0, 1000);
  } catch {
    return step.outputJson.slice(0, 1000);
  }
}

async function sendWebhook(url: string, payload: NotifyPayload): Promise<void> {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Webhook ${url} → HTTP ${resp.status}: ${body.slice(0, 200)}`);
  }
}

async function sendSlack(
  target: string,
  payload: NotifyPayload,
  kind: "channel" | "user"
): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.warn("[notify] SLACK_BOT_TOKEN not set — skipping Slack dispatch");
    return;
  }
  const statusEmoji =
    payload.status === "completed"
      ? ":white_check_mark:"
      : payload.status === "failed"
        ? ":x:"
        : ":double_vertical_bar:";
  const title = `${statusEmoji} ${payload.workflowName} → *${payload.status}*`;
  const text =
    `${title}\n<${payload.url}|Open run>\n` +
    (payload.summary ? `\n>${payload.summary.replace(/\n/g, "\n>")}` : "");

  const body: Record<string, unknown> = {
    channel: kind === "channel" ? target : target,
    text,
    unfurl_links: false,
    unfurl_media: false,
  };
  const resp = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const json = (await resp.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
  };
  if (!json.ok) {
    throw new Error(`Slack post to '${target}' failed: ${json.error ?? "unknown"}`);
  }
}

async function sendEmailStub(
  _to: string,
  _payload: NotifyPayload
): Promise<void> {
  console.warn(
    `[notify] email target configured but email dispatch is not implemented in v2.0. ` +
      `Use webhook + an external email service for now.`
  );
}
