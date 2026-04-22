/**
 * HTTP client wrapper for the Flow Manager backend API.
 *
 * IMPORTANT: This module is the sole integration point between the MCP server
 * and the Flow Manager backend. If backend response shapes change, update the
 * mapping here — not in the tool handlers.
 *
 * WARNING: Never use console.log in MCP code paths — it corrupts the JSON-RPC
 * stdio transport. Use console.error for all logging/debugging.
 */

const DEFAULT_URL = "http://localhost:5001";
const TIMEOUT_MS = 30_000;

/**
 * Returns the base URL for the Flow Manager API.
 * Reads FLOW_MANAGER_URL env var, falling back to http://localhost:5001.
 */
export function getBaseUrl(): string {
  return process.env.FLOW_MANAGER_URL?.replace(/\/+$/, "") || DEFAULT_URL;
}

export class FlowManagerError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "FlowManagerError";
  }
}

/**
 * Generic fetch wrapper with timeout and error handling.
 */
async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${getBaseUrl()}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    const body = await res.json().catch(() => null);

    if (!res.ok) {
      const errMsg =
        (body as Record<string, unknown>)?.error ?? `HTTP ${res.status}`;
      throw new FlowManagerError(String(errMsg), res.status, body);
    }

    return body as T;
  } catch (err) {
    if (err instanceof FlowManagerError) throw err;

    if (err instanceof DOMException && err.name === "AbortError") {
      throw new FlowManagerError(
        `Request to ${path} timed out after ${TIMEOUT_MS / 1000}s`,
        0
      );
    }

    // Connection refused, DNS failure, etc.
    const baseUrl = getBaseUrl();
    throw new FlowManagerError(
      `Flow Manager not reachable at ${baseUrl}. Is the server running? (${(err as Error).message})`,
      0
    );
  } finally {
    clearTimeout(timeout);
  }
}

// ─── API Methods ──────────────────────────────────────────────────────

export interface WorkflowListItem {
  id: string;
  name: string;
  version: number;
  createdAt: string;
}

export interface WorkflowDetail {
  id: string;
  name: string;
  version: number;
  schema: Record<string, unknown>;
  createdAt: string;
}

export interface RunListItem {
  id: string;
  workflowId: string;
  workflowName: string;
  status: string;
  createdAt: string;
}

export interface RunDetail {
  id: string;
  workflow_id: string;
  status: string;
  input_json: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  steps: Array<{
    id: string;
    node_id: string;
    status: string;
    started_at: string | null;
    completed_at: string | null;
    output_json: string | null;
  }>;
  events: Array<{
    id: string;
    type: string;
    payload_json: string;
    created_at: string;
  }>;
}

export interface CreateWorkflowResponse {
  id: string;
  name: string;
  version: number;
  createdAt: string;
}

export interface StartRunResponse {
  runId: string;
  status: string;
}

/** List all workflows (metadata only). */
export async function listWorkflows(): Promise<WorkflowListItem[]> {
  const data = await request<{ workflows: WorkflowListItem[] }>("/api/workflows");
  return data.workflows ?? [];
}

/** Get full workflow detail including schema. */
export async function getWorkflow(id: string): Promise<WorkflowDetail> {
  return request<WorkflowDetail>(`/api/workflows/${encodeURIComponent(id)}`);
}

/**
 * Create a new workflow. Wraps nodes+edges into the full schema envelope
 * expected by the backend validator:
 *   { name, schema: { schemaVersion, id, name, entryNodeId, nodes, edges } }
 *
 * Auto-generates:
 *   - schemaVersion = "1.0"
 *   - id = "wf-<random>"  (used as flowId by backend)
 *   - entryNodeId = first node's id (if not provided)
 *   - name inside schema = workflow name
 */
export async function createWorkflow(
  name: string,
  nodes: Array<Record<string, unknown>>,
  edges: Array<Record<string, unknown>>,
  entryNodeId?: string
): Promise<CreateWorkflowResponse> {
  const resolvedEntryNodeId =
    entryNodeId ??
    (nodes.length > 0 ? String(nodes[0].id ?? "node-0") : "node-0");

  return request<CreateWorkflowResponse>("/api/workflows", {
    method: "POST",
    body: JSON.stringify({
      name,
      schema: {
        schemaVersion: "1.0",
        id: `wf-${Date.now().toString(36)}`,
        name,
        entryNodeId: resolvedEntryNodeId,
        nodes,
        edges,
      },
    }),
  });
}

/** Start a workflow run. */
export async function startRun(
  workflowId: string,
  input: Record<string, unknown> = {}
): Promise<StartRunResponse> {
  return request<StartRunResponse>("/api/runs", {
    method: "POST",
    body: JSON.stringify({ workflowId, input }),
  });
}

/** List recent runs (backend returns up to 50). */
export async function listRuns(): Promise<RunListItem[]> {
  const data = await request<{ runs: RunListItem[] }>("/api/runs");
  return data.runs ?? [];
}

/** Get detailed run info including steps and events. */
export async function getRunDetail(runId: string): Promise<RunDetail> {
  return request<RunDetail>(`/api/runs/${encodeURIComponent(runId)}`);
}
