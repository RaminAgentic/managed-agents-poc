import express, { Request, Response } from "express";
import cors from "cors";
import path from "path";

// Trigger API-key validation at startup (fail-fast)
import "./config/env";

import { runOrchestrator } from "./agent/orchestrator";

// In dev, Vite serves the frontend on 5002 and proxies /api to 5001.
// In production, Express serves everything (static + API) on 5002.
const PORT = process.env.NODE_ENV === "production" ? 5002 : 5001;
const app = express();

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- API Routes ---

/** GET /api/health — lightweight probe for proxy / CI smoke tests */
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

/**
 * POST /api/chat
 * Body: { prompt: string }
 * Returns: { response: string, agentType: "weather" | "research" | "other" }
 */
app.post("/api/chat", async (req: Request, res: Response) => {
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

// --- Production: serve React build ---
if (process.env.NODE_ENV === "production") {
  const clientDist = path.join(__dirname, "..", "client", "dist");
  app.use(express.static(clientDist));
  app.get("*", (_req: Request, res: Response) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`\n🌐 Managed Agents POC → http://localhost:${PORT}\n`);
});
