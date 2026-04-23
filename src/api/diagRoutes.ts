/**
 * Diagnostic endpoints. Low-risk smoke tests for verifying that
 * external integrations (Salesforce, Slack) are reachable and
 * authenticated — so we can isolate "is the infra working?" from
 * "is the agent's prompt working?".
 */
import { Router, Request, Response } from "express";
import { dispatchSalesforceTool } from "../tools/salesforce";

const router = Router();

/**
 * GET /api/diag/salesforce/oauth
 * Direct call to Salesforce's OAuth2 token endpoint — bypasses jsforce
 * entirely so we see the exact HTTP response. Best for diagnosing auth
 * failures ("authentication failure" from jsforce is too vague).
 */
router.get("/diag/salesforce/oauth", async (_req: Request, res: Response) => {
  const loginUrl = process.env.SF_LOGIN_URL ?? "https://login.salesforce.com";
  const clientId = process.env.SF_CLIENT_ID;
  const clientSecret = process.env.SF_CLIENT_SECRET;
  const username = process.env.SF_USERNAME;
  const password = process.env.SF_PASSWORD;

  const missing = [
    !loginUrl && "SF_LOGIN_URL",
    !clientId && "SF_CLIENT_ID",
    !clientSecret && "SF_CLIENT_SECRET",
    !username && "SF_USERNAME",
    !password && "SF_PASSWORD",
  ].filter(Boolean);
  if (missing.length > 0) {
    res.status(500).json({ ok: false, missingEnvVars: missing });
    return;
  }

  try {
    const body = new URLSearchParams({
      grant_type: "password",
      client_id: clientId as string,
      client_secret: clientSecret as string,
      username: username as string,
      password: password as string,
    });
    const response = await fetch(
      `${loginUrl.replace(/\/+$/, "")}/services/oauth2/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      }
    );
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // leave as text
    }
    res.status(response.status).json({
      ok: response.ok,
      status: response.status,
      body: parsed,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/**
 * GET /api/diag/salesforce
 * Runs a tiny SOQL query as the configured SF user. Returns user info
 * on success, or a string error on failure. Safe to call from anywhere.
 */
router.get("/diag/salesforce", async (_req: Request, res: Response) => {
  try {
    const raw = await dispatchSalesforceTool("sf_query", {
      soql: "SELECT Id, Name, InstanceName FROM Organization LIMIT 1",
    });
    // The tool returns a JSON string — parse for cleaner display
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
    const ok = typeof raw === "string" && !raw.startsWith("Error:");
    res.status(ok ? 200 : 500).json({ ok, result: body });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
