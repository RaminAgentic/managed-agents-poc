/**
 * Run API client — thin fetch wrappers.
 */

import type { RunSummary, RunDetail, RunStep, RunEvent } from "../types";

const BASE = "/api";

export interface StartRunResponse {
  runId: string;
  status: string;
  message?: string;
}

export async function startRun(
  workflowId: string,
  input: Record<string, string>
): Promise<StartRunResponse> {
  const res = await fetch(`${BASE}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workflowId, input }),
  });

  const body = await res.json();

  if (!res.ok) {
    const detail = body.details ? `: ${body.details.join(", ")}` : "";
    throw new Error((body.error || `HTTP ${res.status}`) + detail);
  }

  return body;
}

/**
 * Fetch recent runs (newest first, max 50).
 */
export async function listRuns(): Promise<{ runs: RunSummary[] }> {
  const res = await fetch(`${BASE}/runs`);
  if (!res.ok) throw new Error(`Failed to fetch runs: HTTP ${res.status}`);
  return res.json();
}

/**
 * Fetch a single run with steps and events.
 */
export async function getRunDetail(id: string): Promise<RunDetail> {
  const res = await fetch(`${BASE}/runs/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch run: HTTP ${res.status}`);
  return res.json();
}

/**
 * Lightweight poll endpoint — steps + events only.
 */
export async function getRunSteps(
  id: string
): Promise<{ steps: RunStep[]; events: RunEvent[] }> {
  const res = await fetch(`${BASE}/runs/${id}/steps`);
  if (!res.ok) throw new Error(`Failed to fetch run steps: HTTP ${res.status}`);
  return res.json();
}
