/**
 * Approval routes — handle Slack button clicks (and manual resolutions)
 * for human_gate nodes.
 *
 * GET  /api/approval/:stepId?d=<decision>&by=<user>&c=<comment>
 *   - Resolves the most recent pending Approval row for the given step
 *   - Used by Slack Block Kit URL buttons (no Slack interactivity webhook
 *     required)
 *   - Returns an HTML confirmation page so the approver sees something
 *     after clicking
 *
 * POST /api/approval/:stepId
 *   Body: { decision: string, comment?: string, slackUserId?: string }
 *   - JSON API equivalent for programmatic resolution (curl, Cowork, etc.)
 */
import { Router, Request, Response } from "express";
import prisma from "../db/client";

const router = Router();

async function resolveApproval(
  stepId: string,
  decision: string,
  slackUserId?: string | null,
  comment?: string | null
): Promise<{ ok: true; approvalId: string } | { ok: false; error: string }> {
  // Find the most recent pending approval for this step
  const pending = await prisma.approval.findFirst({
    where: { stepId, decision: "pending" },
    orderBy: { createdAt: "desc" },
  });

  if (!pending) {
    return { ok: false, error: "No pending approval found for this step" };
  }

  await prisma.approval.update({
    where: { id: pending.id },
    data: {
      decision,
      slackUserId: slackUserId ?? pending.slackUserId,
      comment: comment ?? pending.comment,
    },
  });

  return { ok: true, approvalId: pending.id };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderConfirmationPage(
  decision: string,
  ok: boolean,
  message: string
): string {
  const bg = ok ? "#f0fdf4" : "#fef2f2";
  const border = ok ? "#16a34a" : "#dc2626";
  const title = ok ? `Decision recorded: ${decision}` : "Couldn't record decision";
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; background: ${bg}; min-height: 100vh; display: flex; align-items: center; justify-content: center; margin: 0; }
    .card { max-width: 420px; background: white; border-left: 6px solid ${border}; padding: 2rem; border-radius: 6px; box-shadow: 0 10px 20px rgba(0,0,0,0.08); }
    h1 { margin: 0 0 0.5rem; font-size: 1.4rem; }
    p { margin: 0; color: #4b5563; }
    code { background: #f3f4f6; padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.9em; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
}

/**
 * GET /api/approval/:stepId?d=<decision>
 *
 * Used by Slack button URLs. Returns an HTML page.
 */
router.get("/approval/:stepId", async (req: Request, res: Response) => {
  const stepId = req.params.stepId;
  const decision =
    typeof req.query.d === "string"
      ? req.query.d
      : typeof req.query.decision === "string"
        ? req.query.decision
        : "";

  const slackUserId =
    typeof req.query.by === "string" ? req.query.by : undefined;
  const comment =
    typeof req.query.c === "string" ? req.query.c : undefined;

  if (!decision) {
    res
      .status(400)
      .type("html")
      .send(
        renderConfirmationPage(
          "",
          false,
          "Missing ?d=<decision> query parameter."
        )
      );
    return;
  }

  const result = await resolveApproval(stepId, decision, slackUserId, comment);
  if (!result.ok) {
    res
      .status(404)
      .type("html")
      .send(renderConfirmationPage(decision, false, result.error));
    return;
  }

  res
    .status(200)
    .type("html")
    .send(
      renderConfirmationPage(
        decision,
        true,
        `Thanks. The workflow will continue momentarily.`
      )
    );
});

/**
 * POST /api/approval/:stepId
 */
router.post("/approval/:stepId", async (req: Request, res: Response) => {
  const stepId = req.params.stepId;
  const decision =
    typeof req.body?.decision === "string" ? req.body.decision : "";
  const slackUserId =
    typeof req.body?.slackUserId === "string" ? req.body.slackUserId : undefined;
  const comment =
    typeof req.body?.comment === "string" ? req.body.comment : undefined;

  if (!decision) {
    res.status(400).json({ error: "'decision' is required" });
    return;
  }

  const result = await resolveApproval(stepId, decision, slackUserId, comment);
  if (!result.ok) {
    res.status(404).json({ error: result.error });
    return;
  }
  res.json({ ok: true, approvalId: result.approvalId });
});

/**
 * GET /api/approvals/pending
 * Returns all currently-pending approvals (for the Run Detail UI).
 */
router.get("/approvals/pending", async (_req: Request, res: Response) => {
  const pending = await prisma.approval.findMany({
    where: { decision: "pending" },
    orderBy: { createdAt: "desc" },
    include: {
      step: {
        select: { id: true, runId: true, nodeId: true },
      },
    },
  });
  res.json({
    approvals: pending.map((a) => ({
      id: a.id,
      step_id: a.stepId,
      run_id: a.step.runId,
      node_id: a.step.nodeId,
      slack_channel: a.slackChannel,
      created_at: a.createdAt.toISOString(),
    })),
  });
});

export default router;
