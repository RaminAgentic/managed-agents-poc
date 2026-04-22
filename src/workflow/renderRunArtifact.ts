/**
 * Render a workflow run as a self-contained React component string
 * suitable for Cowork's artifact system.
 *
 * The output is a single-file React component with inline Tailwind-ish
 * styles that visualizes the run graphically:
 *   - Header: workflow name, status pill, total duration
 *   - Per-node cards arranged in execution order with:
 *       * node type icon + name
 *       * status pill + duration
 *       * agent version chip
 *       * truncated output preview
 *   - Footer: link to the underlying data
 *
 * The string is meant to be passed through as-is to Cowork's Claude with
 * the instruction "create an artifact from this React component". The
 * model recognizes the pattern and promotes it.
 */
import type { WorkflowSchema } from "./types";
import type { RunStepRow, WorkflowRunRow } from "./persistence";

interface RunSummary {
  run: WorkflowRunRow & { workflow_name?: string };
  steps: RunStepRow[];
}

function statusTone(status: string): string {
  switch (status) {
    case "completed":
      return "bg-emerald-100 text-emerald-700 border-emerald-300";
    case "running":
      return "bg-blue-100 text-blue-700 border-blue-300 animate-pulse";
    case "awaiting_approval":
      return "bg-amber-100 text-amber-800 border-amber-300";
    case "failed":
      return "bg-red-100 text-red-700 border-red-300";
    default:
      return "bg-gray-100 text-gray-600 border-gray-300";
  }
}

function nodeEmoji(type: string | undefined): string {
  switch (type) {
    case "input":      return "📥";
    case "agent":      return "🤖";
    case "gate":       return "🔀";
    case "router":     return "🧭";
    case "human_gate": return "🙋";
    case "finalize":   return "🏁";
    default:           return "•";
  }
}

function durationSeconds(started: string, ended: string | null): number | null {
  if (!ended) return null;
  return (new Date(ended).getTime() - new Date(started).getTime()) / 1000;
}

function escapeForJs(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}

export function renderRunAsReactArtifact(
  schema: WorkflowSchema,
  summary: RunSummary
): string {
  const nodeById = new Map(schema.nodes.map((n) => [n.id, n]));

  const stepsForTemplate = summary.steps.map((s) => {
    const node = nodeById.get(s.node_id);
    let outputPreview = "";
    if (s.output_json) {
      try {
        const obj = JSON.parse(s.output_json);
        const text =
          typeof obj?.text === "string"
            ? obj.text
            : typeof obj === "string"
              ? obj
              : JSON.stringify(obj);
        outputPreview = truncate(text, 240);
      } catch {
        outputPreview = truncate(s.output_json, 240);
      }
    }
    return {
      nodeId: s.node_id,
      nodeName: node?.name ?? s.node_id,
      nodeType: node?.type ?? "unknown",
      status: s.status,
      emoji: nodeEmoji(node?.type),
      tone: statusTone(s.status),
      durationSec: durationSeconds(s.started_at, s.completed_at),
      agentVersion: s.agent_version,
      anthropicAgentId: s.anthropic_agent_id,
      error: s.error_message,
      outputPreview,
    };
  });

  const runDurationSec =
    summary.run.started_at && summary.run.completed_at
      ? durationSeconds(summary.run.started_at, summary.run.completed_at)
      : null;

  const stepsLiteral = escapeForJs(JSON.stringify(stepsForTemplate));
  const runLiteral = escapeForJs(
    JSON.stringify({
      id: summary.run.id,
      workflowName: summary.run.workflow_name ?? schema.name,
      status: summary.run.status,
      runDurationSec,
      createdAt: summary.run.created_at,
    })
  );

  return `export default function RunDashboard() {
  const run = ${runLiteral ? `JSON.parse(\`${runLiteral}\`)` : "{}"};
  const steps = ${stepsLiteral ? `JSON.parse(\`${stepsLiteral}\`)` : "[]"};

  const statusPill = (status) => {
    const tones = {
      completed: "bg-emerald-100 text-emerald-700 border-emerald-300",
      running: "bg-blue-100 text-blue-700 border-blue-300 animate-pulse",
      awaiting_approval: "bg-amber-100 text-amber-800 border-amber-300",
      failed: "bg-red-100 text-red-700 border-red-300",
      pending: "bg-gray-100 text-gray-600 border-gray-300",
    };
    return tones[status] || tones.pending;
  };

  const runPill = statusPill(run.status);

  return (
    <div className="p-6 max-w-4xl mx-auto font-sans">
      <div className="border border-slate-200 rounded-2xl shadow-sm overflow-hidden bg-white">
        <div className="bg-gradient-to-br from-slate-900 to-slate-700 text-white px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-widest text-slate-300">
                Managed Agents POC
              </div>
              <h1 className="text-2xl font-semibold mt-1">{run.workflowName}</h1>
              <div className="text-xs font-mono text-slate-400 mt-1">
                run {run.id}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className={\`text-xs font-semibold px-3 py-1 rounded-full border \${runPill}\`}>
                {run.status}
              </span>
              {run.runDurationSec != null && (
                <span className="text-xs text-slate-300">
                  {run.runDurationSec.toFixed(1)}s total
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 grid gap-3">
          {steps.length === 0 && (
            <div className="text-sm text-slate-500 italic px-2 py-4">
              No steps have executed yet.
            </div>
          )}
          {steps.map((s, i) => (
            <div
              key={i}
              className="border border-slate-200 rounded-xl p-4 hover:border-slate-300 transition"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-2xl shrink-0">{s.emoji}</span>
                  <div className="min-w-0">
                    <div className="font-medium truncate">{s.nodeName}</div>
                    <div className="text-xs text-slate-500">
                      <span className="font-mono">{s.nodeType}</span>
                      {s.agentVersion != null && (
                        <span className="ml-2 inline-block px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[10px] font-mono">
                          agent v{s.agentVersion}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={\`text-xs font-semibold px-2 py-0.5 rounded-full border \${statusPill(s.status)}\`}>
                    {s.status}
                  </span>
                  {s.durationSec != null && (
                    <span className="text-xs text-slate-400">
                      {s.durationSec.toFixed(1)}s
                    </span>
                  )}
                </div>
              </div>

              {s.outputPreview && (
                <div className="mt-3 p-3 bg-slate-50 rounded text-xs text-slate-700 font-mono whitespace-pre-wrap">
                  {s.outputPreview}
                </div>
              )}
              {s.error && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700 font-mono whitespace-pre-wrap">
                  {s.error}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
`;
}
