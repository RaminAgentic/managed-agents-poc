/**
 * Run API client — thin fetch wrappers.
 */

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
