/**
 * Workflow trigger scheduler (v2).
 *
 * Scans all workflows at startup and on demand, collecting their
 * `triggers` config. For each cron'd workflow, a minimal matcher is
 * kept in memory; a single tick (every 60s) fires any workflow whose
 * cron expression matches the current minute.
 *
 * Webhook triggers are registered via `registerWebhookRoutes` and
 * handled by a single Express route (`POST /triggers/:path`). Each
 * invocation submits a new WorkflowRun with the posted JSON body as
 * input.
 *
 * Cron support is intentionally minimal (5-field UTC, numeric ranges,
 * steps, wildcards, comma lists, and MON–SUN names in the day-of-week
 * field). The mirror should swap in `node-cron` or `croner` for real
 * production use — that's strictly a drop-in replacement for `matchCron`.
 */
import type { Router, Request, Response } from "express";
import { Router as makeRouter } from "express";
import prisma from "../db/client";
import type { WorkflowSchema } from "./types";
import { validateWorkflowSchema } from "./schemaValidator";
import { executeWorkflow } from "./executor";
import { createWorkflowRun, updateRunStatus } from "./persistence";

interface CronJob {
  workflowId: string;
  workflowName: string;
  cronExpr: string;
}

interface WebhookEntry {
  workflowId: string;
  workflowName: string;
  path: string;
  secret?: string;
}

let cronJobs: CronJob[] = [];
let webhookTable = new Map<string, WebhookEntry>();
let cronTickHandle: NodeJS.Timeout | null = null;

export async function bootScheduler(): Promise<void> {
  await reloadTriggers();
  if (cronTickHandle) clearInterval(cronTickHandle);
  // Align the tick to the start of the next minute, then every 60s.
  const now = new Date();
  const msUntilNextMinute =
    (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
  setTimeout(() => {
    fireCronMatches(new Date()).catch((e) =>
      console.warn("[scheduler] tick failed:", e)
    );
    cronTickHandle = setInterval(() => {
      fireCronMatches(new Date()).catch((e) =>
        console.warn("[scheduler] tick failed:", e)
      );
    }, 60_000);
  }, Math.max(0, msUntilNextMinute));
  console.log(
    `[scheduler] booted. ${cronJobs.length} cron job(s), ${webhookTable.size} webhook trigger(s).`
  );
}

/** Re-scan the workflows table and refresh the trigger tables. Call this
 *  whenever a workflow is created or updated. */
export async function reloadTriggers(): Promise<void> {
  const all = await prisma.workflow.findMany({
    select: { id: true, name: true, schemaJson: true },
  });
  const nextCron: CronJob[] = [];
  const nextWebhooks = new Map<string, WebhookEntry>();
  for (const w of all) {
    let schema: WorkflowSchema;
    try {
      schema = JSON.parse(w.schemaJson) as WorkflowSchema;
    } catch {
      continue;
    }
    const t = schema.triggers;
    if (!t) continue;
    if (typeof t.cron === "string" && t.cron.trim()) {
      nextCron.push({
        workflowId: w.id,
        workflowName: w.name,
        cronExpr: t.cron.trim(),
      });
    }
    if (t.webhook && typeof t.webhook.path === "string") {
      const path = t.webhook.path.replace(/^\/+|\/+$/g, "");
      if (path.length > 0) {
        nextWebhooks.set(path, {
          workflowId: w.id,
          workflowName: w.name,
          path,
          secret: t.webhook.secret,
        });
      }
    }
  }
  cronJobs = nextCron;
  webhookTable = nextWebhooks;
  console.log(
    `[scheduler] loaded ${cronJobs.length} cron job(s), ${webhookTable.size} webhook trigger(s).`
  );
}

async function fireCronMatches(now: Date): Promise<void> {
  for (const job of cronJobs) {
    if (matchCron(job.cronExpr, now)) {
      console.log(
        `[scheduler] cron fire: ${job.workflowName} (${job.workflowId})`
      );
      submitRun(job.workflowId, {}).catch((e) =>
        console.error(`[scheduler] cron run ${job.workflowId} failed:`, e)
      );
    }
  }
}

async function submitRun(
  workflowId: string,
  input: Record<string, unknown>
): Promise<string> {
  const w = await prisma.workflow.findUnique({ where: { id: workflowId } });
  if (!w) throw new Error(`Workflow ${workflowId} not found`);
  const schema = JSON.parse(w.schemaJson) as WorkflowSchema;
  const validation = validateWorkflowSchema(schema);
  if (!validation.valid) {
    throw new Error(
      `Workflow ${workflowId} schema invalid: ${validation.errors.join(", ")}`
    );
  }
  const runId = await createWorkflowRun(workflowId, input);
  executeWorkflow(runId, schema, input).catch(async (err) => {
    console.error(`[scheduler] run ${runId} failed:`, err);
    try {
      await updateRunStatus(runId, "failed");
    } catch {
      /* swallow */
    }
  });
  return runId;
}

// ── Webhook routes ─────────────────────────────────────────────────

export function webhookRouter(): Router {
  const router = makeRouter();
  router.post("/triggers/:path", async (req: Request, res: Response) => {
    try {
      const key = (req.params.path ?? "").replace(/^\/+|\/+$/g, "");
      const entry = webhookTable.get(key);
      if (!entry) {
        res.status(404).json({ error: `No webhook trigger for '${key}'` });
        return;
      }
      if (entry.secret) {
        const sig = req.headers["x-trigger-signature"];
        if (typeof sig !== "string" || sig !== entry.secret) {
          res.status(401).json({ error: "Invalid X-Trigger-Signature" });
          return;
        }
      }
      const payload =
        req.body && typeof req.body === "object"
          ? (req.body as Record<string, unknown>)
          : {};
      const runId = await submitRun(entry.workflowId, payload);
      res.status(202).json({
        runId,
        workflowId: entry.workflowId,
        status: "pending",
      });
    } catch (err) {
      console.error("[scheduler] webhook dispatch error:", err);
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : "unknown" });
    }
  });
  return router;
}

// ── Minimal cron matcher ────────────────────────────────────────────

const DOW_NAMES: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

/**
 * Match a cron expression against a Date. 5-field format (UTC):
 *   minute hour day-of-month month day-of-week
 *
 * Supports:
 *   - wildcards (*)
 *   - comma lists (1,5,30)
 *   - ranges (0-5)
 *   - steps (* /5, 0-20/5)
 *   - day-of-week names (MON, TUE, ...)
 *   - when both day-of-month and day-of-week are non-wildcard, fires on
 *     EITHER match (standard cron semantics).
 *
 * Not supported: L, W, # special chars. Sufficient for POC fixtures.
 */
export function matchCron(expr: string, at: Date): boolean {
  const parts = expr.split(/\s+/).filter(Boolean);
  if (parts.length !== 5) return false;

  const minute = at.getUTCMinutes();
  const hour = at.getUTCHours();
  const dom = at.getUTCDate();
  const month = at.getUTCMonth() + 1;
  const dow = at.getUTCDay();

  const [mSpec, hSpec, domSpec, monSpec, dowSpec] = parts;

  const minuteOk = matchField(mSpec, minute, 0, 59);
  const hourOk = matchField(hSpec, hour, 0, 23);
  const monthOk = matchField(monSpec, month, 1, 12);
  if (!minuteOk || !hourOk || !monthOk) return false;

  const domStar = domSpec === "*";
  const dowStar = dowSpec === "*";
  const domOk = matchField(domSpec, dom, 1, 31);
  const dowOk = matchDowField(dowSpec, dow);

  // Cron semantics: if both day-of-month and day-of-week are given, fire
  // on EITHER. If one is wildcard, the other is the gate.
  if (domStar && dowStar) return true;
  if (domStar) return dowOk;
  if (dowStar) return domOk;
  return domOk || dowOk;
}

function matchField(spec: string, value: number, min: number, max: number): boolean {
  for (const part of spec.split(",")) {
    if (matchPart(part, value, min, max)) return true;
  }
  return false;
}

function matchDowField(spec: string, value: number): boolean {
  for (const part of spec.split(",")) {
    const resolved = resolveDowPart(part);
    if (matchPart(resolved, value, 0, 6)) return true;
  }
  return false;
}

function resolveDowPart(part: string): string {
  return part
    .toUpperCase()
    .replace(/SUN|MON|TUE|WED|THU|FRI|SAT/g, (m) => String(DOW_NAMES[m]));
}

function matchPart(part: string, value: number, min: number, max: number): boolean {
  // Step syntax: "*/5" or "0-20/5"
  let step = 1;
  let body = part;
  const slash = part.indexOf("/");
  if (slash >= 0) {
    body = part.slice(0, slash) || "*";
    step = parseInt(part.slice(slash + 1), 10);
    if (!Number.isFinite(step) || step <= 0) return false;
  }

  let lo = min;
  let hi = max;
  if (body !== "*") {
    if (body.includes("-")) {
      const [a, b] = body.split("-").map((n) => parseInt(n, 10));
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      lo = a;
      hi = b;
    } else {
      const v = parseInt(body, 10);
      if (!Number.isFinite(v)) return false;
      lo = v;
      hi = v;
    }
  }

  if (value < lo || value > hi) return false;
  return (value - lo) % step === 0;
}
