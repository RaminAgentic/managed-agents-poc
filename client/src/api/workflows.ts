/**
 * Workflow API client — thin fetch wrappers.
 */
import type { WorkflowSchema } from "../workflow/types";

const BASE = "/api";

export async function saveWorkflow(
  schema: WorkflowSchema,
  name: string
): Promise<{ id: string; name: string }> {
  const res = await fetch(`${BASE}/workflows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, schema }),
  });

  const body = await res.json();

  if (!res.ok) {
    const detail = body.details ? `: ${body.details.join(", ")}` : "";
    throw new Error(body.error + detail || `HTTP ${res.status}`);
  }

  return body;
}

export async function updateWorkflow(
  id: string,
  schema: WorkflowSchema,
  name: string
): Promise<{ id: string; name: string }> {
  const res = await fetch(`${BASE}/workflows/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, schema }),
  });

  const body = await res.json();

  if (!res.ok) {
    const detail = body.details ? `: ${body.details.join(", ")}` : "";
    throw new Error((body.error ?? `HTTP ${res.status}`) + detail);
  }

  return body;
}

export interface WorkflowListItem {
  id: string;
  name: string;
  createdAt: string;
}

export async function listWorkflows(): Promise<WorkflowListItem[]> {
  const res = await fetch(`${BASE}/workflows`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body.workflows ?? [];
}

export async function getWorkflow(
  id: string
): Promise<{ id: string; name: string; schema: WorkflowSchema }> {
  const res = await fetch(`${BASE}/workflows/${id}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}
