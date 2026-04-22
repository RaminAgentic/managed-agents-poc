/**
 * Persistence helpers for workflow execution tracking.
 *
 * Thin wrappers around better-sqlite3 — no business logic here.
 * Every state transition during execution gets recorded so the
 * run history is fully auditable.
 *
 * Design notes (v1):
 * - No transactions — per-row inserts are fine for POC and simplify debugging.
 * - JSON payloads are stored as TEXT via JSON.stringify.
 * - IDs are generated via crypto.randomUUID().
 * - Output JSON > 100KB is truncated to prevent SQLite bloat.
 */
import crypto from "crypto";
import db from "../db/client";
import type { RunStatus, StepStatus, EventType } from "./types";

const MAX_OUTPUT_BYTES = 100 * 1024; // 100 KB

function generateId(): string {
  return crypto.randomUUID();
}

function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Safely stringify and optionally truncate a JSON payload.
 */
function safeStringify(value: unknown): string {
  const raw = JSON.stringify(value);
  if (raw.length > MAX_OUTPUT_BYTES) {
    const truncated = raw.slice(0, MAX_OUTPUT_BYTES);
    return JSON.stringify({ _truncated: true, _preview: truncated });
  }
  return raw;
}

// ── Prepared statements (cached for performance) ────────────────────

const insertRunStep = db.prepare(`
  INSERT INTO run_steps (id, run_id, node_id, status, started_at)
  VALUES (?, ?, ?, 'running', ?)
`);

const updateStepCompleted = db.prepare(`
  UPDATE run_steps
  SET status = 'completed', output_json = ?, completed_at = ?
  WHERE id = ?
`);

const updateStepFailed = db.prepare(`
  UPDATE run_steps
  SET status = 'failed', error_message = ?, error_stack = ?, completed_at = ?
  WHERE id = ?
`);

const updateStepAgentSession = db.prepare(`
  UPDATE run_steps SET agent_session_id = ? WHERE id = ?
`);

const insertEvent = db.prepare(`
  INSERT INTO run_events (id, run_id, step_id, event_type, payload, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const updateRunStatusStmt = db.prepare(`
  UPDATE workflow_runs SET status = ?, completed_at = ? WHERE id = ?
`);

const updateRunStarted = db.prepare(`
  UPDATE workflow_runs SET status = 'running', started_at = ? WHERE id = ?
`);

// ── Public API ──────────────────────────────────────────────────────

/**
 * Create a RunStep record with status='running'.
 * @returns The new step's ID.
 */
export function createRunStep(runId: string, nodeId: string): string {
  const id = generateId();
  insertRunStep.run(id, runId, nodeId, nowISO());
  return id;
}

/**
 * Mark a step as completed with its output JSON.
 */
export function completeRunStep(stepId: string, outputs: unknown): void {
  const outputJson = safeStringify(outputs);
  updateStepCompleted.run(outputJson, nowISO(), stepId);
}

/**
 * Mark a step as failed with error details.
 */
export function failRunStep(stepId: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? (error.stack ?? "") : "";
  updateStepFailed.run(message, stack, nowISO(), stepId);
}

/**
 * Store the agent session ID on a step (for agent nodes).
 */
export function setStepAgentSession(stepId: string, sessionId: string): void {
  updateStepAgentSession.run(sessionId, stepId);
}

/**
 * Insert a RunEvent (audit trail entry).
 * @param stepId - May be null for run-level events (e.g. workflow_completed).
 */
export function logEvent(
  runId: string,
  stepId: string | null,
  eventType: EventType,
  payload: unknown = {}
): void {
  const id = generateId();
  insertEvent.run(id, runId, stepId, eventType, safeStringify(payload), nowISO());
}

/**
 * Update the status of a WorkflowRun.
 * Sets completedAt on terminal states (completed, failed).
 */
export function updateRunStatus(runId: string, status: RunStatus): void {
  const isTerminal = status === "completed" || status === "failed";
  const completedAt = isTerminal ? nowISO() : null;

  if (status === "running") {
    updateRunStarted.run(nowISO(), runId);
  } else {
    updateRunStatusStmt.run(status, completedAt, runId);
  }
}

// ── Workflow CRUD (minimal, needed for Sprint 8 API) ────────────────

const insertWorkflow = db.prepare(`
  INSERT INTO workflows (id, name, schema_json, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?)
`);

const findWorkflowById = db.prepare(`
  SELECT * FROM workflows WHERE id = ?
`);

const insertWorkflowRun = db.prepare(`
  INSERT INTO workflow_runs (id, workflow_id, status, input_json, created_at)
  VALUES (?, ?, 'pending', ?, ?)
`);

const findRunById = db.prepare(`
  SELECT * FROM workflow_runs WHERE id = ?
`);

const findStepsByRunId = db.prepare(`
  SELECT * FROM run_steps WHERE run_id = ? ORDER BY started_at ASC
`);

const findEventsByRunId = db.prepare(`
  SELECT * FROM run_events WHERE run_id = ? ORDER BY created_at ASC
`);

const findAllWorkflows = db.prepare(`
  SELECT * FROM workflows ORDER BY created_at DESC
`);

const findRunsByWorkflowId = db.prepare(`
  SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY created_at DESC
`);

export interface WorkflowRow {
  id: string;
  name: string;
  schema_json: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowRunRow {
  id: string;
  workflow_id: string;
  status: string;
  input_json: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface RunStepRow {
  id: string;
  run_id: string;
  node_id: string;
  status: string;
  output_json: string | null;
  error_message: string | null;
  error_stack: string | null;
  agent_session_id: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface RunEventRow {
  id: string;
  run_id: string;
  step_id: string | null;
  event_type: string;
  payload: string;
  created_at: string;
}

/**
 * Create a new workflow definition.
 */
export function createWorkflow(id: string, name: string, schemaJson: string): void {
  const now = nowISO();
  insertWorkflow.run(id, name, schemaJson, now, now);
}

/**
 * Find a workflow by ID.
 */
export function getWorkflow(id: string): WorkflowRow | undefined {
  return findWorkflowById.get(id) as WorkflowRow | undefined;
}

/**
 * List all workflows.
 */
export function listWorkflows(): WorkflowRow[] {
  return findAllWorkflows.all() as WorkflowRow[];
}

/**
 * Create a new workflow run record.
 * @returns The new run's ID.
 */
export function createWorkflowRun(
  workflowId: string,
  input: Record<string, unknown>
): string {
  const id = generateId();
  insertWorkflowRun.run(id, workflowId, JSON.stringify(input), nowISO());
  return id;
}

/**
 * Get a workflow run by ID.
 */
export function getWorkflowRun(id: string): WorkflowRunRow | undefined {
  return findRunById.get(id) as WorkflowRunRow | undefined;
}

/**
 * Get all runs for a workflow.
 */
export function getRunsByWorkflowId(workflowId: string): WorkflowRunRow[] {
  return findRunsByWorkflowId.all(workflowId) as WorkflowRunRow[];
}

/**
 * Get all steps for a run.
 */
export function getRunSteps(runId: string): RunStepRow[] {
  return findStepsByRunId.all(runId) as RunStepRow[];
}

/**
 * Get all events for a run.
 */
export function getRunEvents(runId: string): RunEventRow[] {
  return findEventsByRunId.all(runId) as RunEventRow[];
}
