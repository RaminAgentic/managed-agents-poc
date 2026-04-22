-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflow_id" TEXT NOT NULL,
    "node_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "config_hash" TEXT NOT NULL,
    "config_json" TEXT NOT NULL,
    "anthropic_agent_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" DATETIME,
    CONSTRAINT "agents_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_run_steps" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "node_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "input_json" TEXT,
    "output_json" TEXT,
    "error_message" TEXT,
    "error_stack" TEXT,
    "agent_session_id" TEXT,
    "agent_id" TEXT,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" DATETIME,
    CONSTRAINT "run_steps_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "workflow_runs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "run_steps_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_run_steps" ("agent_session_id", "completed_at", "error_message", "error_stack", "id", "input_json", "node_id", "output_json", "run_id", "started_at", "status") SELECT "agent_session_id", "completed_at", "error_message", "error_stack", "id", "input_json", "node_id", "output_json", "run_id", "started_at", "status" FROM "run_steps";
DROP TABLE "run_steps";
ALTER TABLE "new_run_steps" RENAME TO "run_steps";
CREATE INDEX "run_steps_run_id_idx" ON "run_steps"("run_id");
CREATE INDEX "run_steps_agent_id_idx" ON "run_steps"("agent_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "agents_workflow_id_idx" ON "agents"("workflow_id");

-- CreateIndex
CREATE UNIQUE INDEX "agents_workflow_id_node_id_version_key" ON "agents"("workflow_id", "node_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "agents_workflow_id_node_id_config_hash_key" ON "agents"("workflow_id", "node_id", "config_hash");
