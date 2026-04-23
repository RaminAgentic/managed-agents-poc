/**
 * Slack trigger routes.
 *
 * POST /api/slack/command — receives Slack slash-command payloads
 *   Expected form body (application/x-www-form-urlencoded):
 *     command     — e.g. "/flow"
 *     text        — "<workflow-name-or-id> <optional json input>"
 *     user_name   — Slack display name of the invoker
 *     response_url — for late async replies (not used in v1)
 *
 * Response: an ephemeral text message with the run ID (or an error).
 * Actual workflow execution is fire-and-forget, so we answer within
 * Slack's 3-second window regardless of how long the run takes.
 *
 * Signature verification: if SLACK_SIGNING_SECRET is set, every request
 * is HMAC-verified against the raw body per Slack's signed-request spec.
 * If unset (local dev), verification is skipped with a warning.
 */
import { Router, Request, Response, NextFunction } from "express";
import express from "express";
import crypto from "crypto";
import { anthropic } from "../config/anthropic";
import type { WorkflowSchema } from "../workflow/types";
import { validateWorkflowSchema } from "../workflow/schemaValidator";
import { executeWorkflow } from "../workflow/executor";
import {
  getWorkflow,
  listWorkflows,
  createWorkflowRun,
  updateRunStatus,
} from "../workflow/persistence";

const router = Router();

// Capture the raw body for HMAC verification, then parse it as form data.
// The `verify` callback runs during parsing and gives us the unparsed bytes.
router.use(
  "/slack",
  express.urlencoded({
    extended: true,
    limit: "100kb",
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  })
);

const MAX_REQUEST_AGE_SECONDS = 60 * 5; // 5 minutes — matches Slack's recommendation

/**
 * Middleware: verify x-slack-signature against SLACK_SIGNING_SECRET.
 *
 * Skips verification if SLACK_SIGNING_SECRET is unset (local dev).
 * Rejects 401 if the signature is missing, the timestamp is stale,
 * or the HMAC doesn't match.
 */
function verifySlackSignature(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.warn(
      "[slackRoutes] SLACK_SIGNING_SECRET is unset — skipping signature verification. Do not run like this in production."
    );
    next();
    return;
  }

  const timestamp = req.header("x-slack-request-timestamp");
  const signature = req.header("x-slack-signature");
  if (!timestamp || !signature) {
    res.status(401).json({ error: "Missing Slack signature headers" });
    return;
  }

  const timestampNum = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(timestampNum)) {
    res.status(401).json({ error: "Invalid Slack timestamp" });
    return;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampNum) > MAX_REQUEST_AGE_SECONDS) {
    res.status(401).json({ error: "Slack request is too old" });
    return;
  }

  const rawBody =
    (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
  const basestring = `v0:${timestamp}:${rawBody.toString("utf8")}`;
  const computed =
    "v0=" +
    crypto
      .createHmac("sha256", signingSecret)
      .update(basestring)
      .digest("hex");

  const sigBuf = Buffer.from(signature);
  const computedBuf = Buffer.from(computed);
  if (
    sigBuf.length !== computedBuf.length ||
    !crypto.timingSafeEqual(sigBuf, computedBuf)
  ) {
    console.warn(
      `[slackRoutes] signature mismatch — bodyLen=${rawBody.length}, ` +
        `secretLen=${signingSecret.length}, ` +
        `got=${signature.slice(0, 12)}..., ` +
        `computed=${computed.slice(0, 12)}...`
    );
    res.status(401).json({ error: "Invalid Slack signature" });
    return;
  }

  next();
}

/**
 * Parse "text" from a Slack slash-command into a workflow selector + input.
 *
 * Supported forms:
 *   "<workflow-name-or-id>"                       — no input
 *   "<workflow-name-or-id> <freeform text...>"    — wrapped as { text: "..." }
 *   "<workflow-name-or-id> {json object}"         — parsed as input
 */
function parseCommandText(text: string): {
  selector: string;
  input: Record<string, unknown>;
} {
  const trimmed = text.trim();
  if (!trimmed) return { selector: "", input: {} };

  const firstSpace = trimmed.indexOf(" ");
  if (firstSpace === -1) {
    return { selector: trimmed, input: {} };
  }

  const selector = trimmed.slice(0, firstSpace);
  const rest = trimmed.slice(firstSpace + 1).trim();

  if (rest.startsWith("{")) {
    try {
      const parsed = JSON.parse(rest);
      if (parsed && typeof parsed === "object") {
        return { selector, input: parsed as Record<string, unknown> };
      }
    } catch {
      // fall through — treat as freeform text
    }
  }

  return { selector, input: { text: rest } };
}

/**
 * Extract structured input values from freeform user text using a cheap
 * Claude call. The workflow's own input-field spec drives the extraction.
 *
 * Returns whatever fields could be confidently extracted. Missing fields
 * are surfaced via the caller (so the Slack response can ask for them).
 */
async function extractInputsFromText(params: {
  userText: string;
  inputSpec: Record<
    string,
    { description?: string; type?: string; required?: boolean; example?: string }
  >;
  workflowPurpose?: string;
}): Promise<{ values: Record<string, unknown>; missing: string[] }> {
  const fieldNames = Object.keys(params.inputSpec);
  if (fieldNames.length === 0) {
    return { values: {}, missing: [] };
  }

  const fieldSpec = Object.entries(params.inputSpec)
    .map(
      ([name, s]) =>
        `  - ${name} (${s.type ?? "string"}${s.required === false ? ", optional" : ""}): ${s.description ?? "(no description)"}${s.example ? ` [example: ${s.example}]` : ""}`
    )
    .join("\n");

  const system =
    "Extract the fields listed below from the user's request. Return ONLY a JSON object with the fields you can fill in confidently. Omit any field you'd have to guess. If a value is stated but not labeled (e.g., a raw URL or a quarter name), infer which field it belongs to. Do not invent values.";

  const user = [
    params.workflowPurpose ? `Workflow purpose: ${params.workflowPurpose}` : null,
    `Fields to extract:\n${fieldSpec}`,
    "",
    `User's request:\n"""${params.userText}"""`,
    "",
    "Respond with ONLY a JSON object. No prose, no code fences.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const resp = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system,
      messages: [{ role: "user", content: user }],
    });
    const raw = resp.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    // Strip a potential ```json fence just in case
    const cleaned = raw.replace(/^```(?:json)?\s*/, "").replace(/```$/, "");
    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== "object") {
      return { values: {}, missing: fieldNames };
    }
    const values = parsed as Record<string, unknown>;
    const missing = fieldNames.filter(
      (f) =>
        params.inputSpec[f].required !== false &&
        (values[f] === undefined || values[f] === null || values[f] === "")
    );
    return { values, missing };
  } catch (err) {
    console.warn("[slackRoutes] input extraction failed:", err);
    return { values: {}, missing: fieldNames };
  }
}

/**
 * Resolve a workflow by ID or by (case-insensitive) name.
 */
async function resolveWorkflow(selector: string): Promise<
  | { id: string; name: string; schema_json: string }
  | null
> {
  // Try by ID first (fast path)
  const byId = await getWorkflow(selector);
  if (byId) {
    return { id: byId.id, name: byId.name, schema_json: byId.schema_json };
  }

  // Fall back to name match
  const all = await listWorkflows();
  const match = all.find(
    (w) => w.name.toLowerCase() === selector.toLowerCase()
  );
  if (match) {
    return { id: match.id, name: match.name, schema_json: match.schema_json };
  }

  return null;
}

/**
 * POST /api/slack/command
 *
 * Slack requires a response within 3 seconds, so we kick off the run
 * asynchronously and reply with the run ID immediately.
 */
router.post("/slack/command", verifySlackSignature, async (req: Request, res: Response) => {
  try {
    const text = typeof req.body?.text === "string" ? req.body.text : "";
    const userName =
      typeof req.body?.user_name === "string" ? req.body.user_name : "someone";

    const { selector, input: parsedInput } = parseCommandText(text);
    if (!selector) {
      res.json({
        response_type: "ephemeral",
        text:
          "Usage: `/flow <workflow-name-or-id> <describe what you want in plain English>`\n" +
          "Examples:\n" +
          "  `/flow deal-desk review opportunity 0063K00000XyZab`\n" +
          "  `/flow incident-commander page on SENTRY-4421`\n" +
          "  `/flow tps-report for Q2 2026`",
      });
      return;
    }

    const workflow = await resolveWorkflow(selector);
    if (!workflow) {
      res.json({
        response_type: "ephemeral",
        text: `Couldn't find a workflow matching \`${selector}\`. Try \`/flow\` with a known workflow name or ID.`,
      });
      return;
    }

    const schema = JSON.parse(workflow.schema_json) as WorkflowSchema;
    const validation = validateWorkflowSchema(schema);
    if (!validation.valid) {
      res.json({
        response_type: "ephemeral",
        text: `Workflow \`${workflow.name}\` has an invalid schema: ${validation.errors.join(", ")}`,
      });
      return;
    }

    // If the workflow's entry node declares field specs, extract the
    // structured inputs from the user's natural-language text. We only
    // trust extraction — user-supplied JSON in parsedInput still wins.
    const entryNode = schema.nodes.find((n) => n.id === schema.entryNodeId);
    const inputCfg = (entryNode?.config ?? {}) as {
      fields?: Record<
        string,
        { description?: string; type?: string; required?: boolean; example?: string }
      >;
      description?: string;
    };
    const fieldSpec = inputCfg.fields;

    let input: Record<string, unknown> = { ...parsedInput };
    const freeformText = typeof parsedInput.text === "string" ? parsedInput.text : "";
    const userGaveJson =
      Object.keys(parsedInput).some((k) => k !== "text");

    if (fieldSpec && !userGaveJson && freeformText) {
      // Keep the extraction fast so Slack's 3s window doesn't blow
      const extracted = await extractInputsFromText({
        userText: freeformText,
        inputSpec: fieldSpec,
        workflowPurpose: inputCfg.description,
      });
      input = { ...extracted.values };

      if (extracted.missing.length > 0) {
        const hintLines = extracted.missing.map((name) => {
          const spec = fieldSpec[name];
          return `  • *${name}* — ${spec.description ?? "(required)"}${spec.example ? `  _e.g._ \`${spec.example}\`` : ""}`;
        });
        res.json({
          response_type: "ephemeral",
          text:
            `I couldn't pull all the required inputs for *${workflow.name}* out of that. ` +
            `Try again and include:\n\n${hintLines.join("\n")}`,
        });
        return;
      }
    }

    // Attach invoker to input so agents can reference it
    const runInput = { ...input, _slackUser: userName };
    const runId = await createWorkflowRun(workflow.id, runInput);

    // Feature gate (mirrors runRoutes.ts)
    if (process.env.ENABLE_WORKFLOW_EXECUTOR === "false") {
      res.json({
        response_type: "ephemeral",
        text: `Run created (executor disabled): \`${runId}\``,
      });
      return;
    }

    executeWorkflow(runId, schema, runInput).catch(async (err) => {
      console.error(`[slackRoutes] Unhandled error in run ${runId}:`, err);
      try {
        await updateRunStatus(runId, "failed");
      } catch (persistErr) {
        console.error(
          `[slackRoutes] Failed to mark run ${runId} as failed:`,
          persistErr
        );
      }
    });

    res.json({
      response_type: "in_channel",
      text: `:rocket: Started *${workflow.name}* — run \`${runId}\` (triggered by @${userName}).`,
    });
  } catch (err: unknown) {
    console.error("[slackRoutes] POST /slack/command error:", err);
    res.status(500).json({
      response_type: "ephemeral",
      text: `Error: ${err instanceof Error ? err.message : "unknown"}`,
    });
  }
});

export default router;
