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
