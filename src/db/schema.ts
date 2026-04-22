/**
 * Database schema initialization.
 *
 * Creates all tables needed for workflow execution tracking.
 * Safe to call multiple times — uses IF NOT EXISTS.
 */
import db from "./client";

export function initializeSchema(): void {
  db.exec(`
    -- Workflow definitions
    CREATE TABLE IF NOT EXISTS workflows (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      schema_json TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Workflow run instances
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id            TEXT PRIMARY KEY,
      workflow_id   TEXT NOT NULL REFERENCES workflows(id),
      status        TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed')),
      input_json    TEXT NOT NULL DEFAULT '{}',
      started_at    TEXT,
      completed_at  TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Individual step executions within a run
    CREATE TABLE IF NOT EXISTS run_steps (
      id            TEXT PRIMARY KEY,
      run_id        TEXT NOT NULL REFERENCES workflow_runs(id),
      node_id       TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','completed','failed')),
      output_json   TEXT,
      error_message TEXT,
      error_stack   TEXT,
      agent_session_id TEXT,
      started_at    TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at  TEXT
    );

    -- Event log (audit trail)
    CREATE TABLE IF NOT EXISTS run_events (
      id          TEXT PRIMARY KEY,
      run_id      TEXT NOT NULL REFERENCES workflow_runs(id),
      step_id     TEXT REFERENCES run_steps(id),
      event_type  TEXT NOT NULL,
      payload     TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_id ON workflow_runs(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_run_steps_run_id ON run_steps(run_id);
    CREATE INDEX IF NOT EXISTS idx_run_events_run_id ON run_events(run_id);
  `);
}
