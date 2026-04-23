import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import path from "path";

// Trigger API-key validation at startup (fail-fast)
import "./config/env";

// Initialize SQLite schema (no-op — Prisma owns the schema via migrations)
import { initializeSchema } from "./db/schema";
initializeSchema();

// Mark any orphaned "running" runs as failed on restart (async)
import { markOrphanedRunsFailed } from "./workflow/persistence";
markOrphanedRunsFailed().then((count) => {
  if (count > 0) {
    console.log(`[startup] Marked ${count} orphaned run(s) as failed.`);
  }
}).catch((err) => {
  console.error("[startup] Failed to mark orphaned runs:", err);
});

import { runOrchestrator } from "./agent/orchestrator";
import workflowRoutes from "./api/workflowRoutes";
import runRoutes from "./api/runRoutes";
import slackRoutes from "./api/slackRoutes";
import approvalRoutes from "./api/approvalRoutes";
import diagRoutes from "./api/diagRoutes";
import { mcpHttpHandler } from "./mcp/httpHandler";

// In dev, Vite serves the frontend on 5002 and proxies /api to 5001.
// In production, Express serves everything (static + API) on 5002.
const PORT = process.env.NODE_ENV === "production" ? 5002 : 5001;
const app = express();

// --- Middleware ---

// 1. CORS — allow Vite dev server and production origins
app.use(cors({
  origin: [
    "http://localhost:5173",
    "http://localhost:5002",
    "http://localhost:5001",
    "https://claude.ai",
  ],
  credentials: true,
}));

// 2. Body parser with 1MB limit
app.use(express.json({ limit: "1mb" }));

// 3. Request logger — minimal, no morgan needed for POC
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on("finish", () => {
    console.log(`[${req.method}] ${req.path} → ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// --- API Routes ---

/** GET /api/health — lightweight probe for proxy / CI smoke tests */
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// Workflow definition endpoints (POST/GET /workflows)
app.use("/api", workflowRoutes);

// Run execution endpoints (POST/GET /runs)
app.use("/api", runRoutes);

// Slack slash-command trigger (POST /slack/command)
app.use("/api", slackRoutes);

// Human-gate approval endpoints (GET/POST /approval/:stepId)
app.use("/api", approvalRoutes);

// Diagnostic smoke tests (GET /diag/salesforce, ...)
app.use("/api", diagRoutes);

/**
 * POST /api/chat
 * Body: { prompt: string }
 * Returns: { response: string, agentType: "weather" | "research" | "other" }
 *
 * Managed agent sessions can take longer than standard messages.create calls
 * (environment spin-up, tool execution, etc.), so we allow up to 5 minutes.
 */
app.post("/api/chat", async (req: Request, res: Response) => {
  // Extend Express response timeout for managed agent processing
  req.setTimeout(300_000); // 5 minutes
  res.setTimeout(300_000);

  const prompt =
    typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";

  if (!prompt) {
    res.status(400).json({ error: "prompt is required and must be a non-empty string" });
    return;
  }

  try {
    const result = await runOrchestrator(prompt);
    res.json(result);
  } catch (err: unknown) {
    console.error("Orchestrator error:", err);
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : "unknown error" });
  }
});

// ── MCP (Streamable HTTP) — for Claude for Work connectors ─────────
app.get("/mcp", (_req: Request, res: Response) => {
  res.json({ name: "flow-manager", version: "1.0.0", transport: "streamable-http" });
});
app.post("/mcp", mcpHttpHandler);

// --- 404 fallback for /api (must be before the SPA catch-all) ---
app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// --- Production: serve React build ---
if (process.env.NODE_ENV === "production") {
  const clientDist = path.join(__dirname, "..", "client", "dist");
  app.use(express.static(clientDist));
  app.get("*", (_req: Request, res: Response) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

// --- Global error handler (MUST have 4 args, MUST be last) ---
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[error]", err);
  const status = ((err as unknown as Record<string, unknown>).status as number) ?? 500;
  res.status(status).json({ error: err.message || "Internal server error" });
});

// --- Global error handling ---
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`\n🌐 Managed Agents POC → http://localhost:${PORT}\n`);
});
