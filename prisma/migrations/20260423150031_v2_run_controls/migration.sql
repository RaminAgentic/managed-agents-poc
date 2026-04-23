-- v2: run-level controls (cancellation, parent/child links, notify override, token tally)

ALTER TABLE "workflow_runs"
  ADD COLUMN "parent_run_id"     TEXT,
  ADD COLUMN "cancel_requested"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "notify_json"       TEXT,
  ADD COLUMN "tokens_used"       INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "workflow_runs_parent_run_id_idx" ON "workflow_runs"("parent_run_id");
