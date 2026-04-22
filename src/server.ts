import express, { Request, Response } from "express";
import path from "path";

// Trigger API-key validation at startup (fail-fast)
import "./config/env";

import { runOrchestrator } from "./agent/orchestrator";

const PORT = 5002;
const app = express();

// --- Middleware ---
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// --- API Routes ---

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

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`\n🌐 Managed Agents POC → http://localhost:${PORT}\n`);
});
