import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";
import Stepper from "@mui/material/Stepper";
import Step from "@mui/material/Step";
import StepLabel from "@mui/material/StepLabel";
import StepContent from "@mui/material/StepContent";
import Divider from "@mui/material/Divider";
import Alert from "@mui/material/Alert";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { getRunDetail } from "../api/runs";
import { useInterval } from "../hooks/useInterval";
import RunStatusChip from "../components/run/RunStatusChip";
import StepStatusIcon from "../components/run/StepStatusIcon";
import AgentOutputView from "../components/run/AgentOutputView";
import JsonBlock from "../components/run/JsonBlock";
import EventLogTable from "../components/run/EventLogTable";
import type { RunDetail, WorkflowSchemaNode } from "../types";

/**
 * Format duration between two ISO strings (or from start to now).
 */
function formatDuration(start: string | null, end: string | null): string {
  if (!start) return "—";
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  const diffMs = endMs - startMs;
  if (diffMs < 0) return "—";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

/** Chip colors for node types */
const NODE_TYPE_COLOR: Record<string, "primary" | "secondary" | "info" | "warning" | "success"> = {
  input: "info",
  agent: "secondary",
  human_gate: "warning",
  finalize: "success",
};

export default function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    if (!runId) return;
    try {
      const detail = await getRunDetail(runId);
      setRun(detail);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load run");
    } finally {
      setLoading(false);
    }
  }, [runId]);

  // Initial fetch
  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  // Poll every 3s while run is active
  const isActive = run?.status === "pending" || run?.status === "running";
  useInterval(fetchDetail, isActive ? 3000 : null);

  // Build node map from workflow schema for name/type lookups
  const nodeMap = useMemo(() => {
    if (!run?.schema_json) return new Map<string, WorkflowSchemaNode>();
    try {
      const schema = JSON.parse(run.schema_json);
      const nodes: WorkflowSchemaNode[] = schema.nodes ?? [];
      return new Map(nodes.map((n) => [n.id, n]));
    } catch {
      return new Map<string, WorkflowSchemaNode>();
    }
  }, [run?.schema_json]);

  // Loading state
  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Skeleton variant="rectangular" height={60} sx={{ mb: 2 }} animation="pulse" />
        <Skeleton variant="rectangular" height={200} animation="pulse" />
      </Box>
    );
  }

  // Error state
  if (error || !run) {
    return (
      <Box sx={{ p: 3 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate("/runs")} sx={{ mb: 2 }}>
          Back to Runs
        </Button>
        <Alert severity="error">{error ?? "Run not found"}</Alert>
      </Box>
    );
  }

  const toggleStep = (stepId: string) => {
    setOpenStep((prev) => (prev === stepId ? null : stepId));
  };

  return (
    <Box sx={{ p: 3, height: "100%", overflow: "auto" }}>
      {/* ── Header ── */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
        <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => navigate("/runs")}>
          Runs
        </Button>
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          {run.workflow_name}
        </Typography>
        <RunStatusChip status={run.status} />
      </Box>

      <Box sx={{ display: "flex", gap: 2, mb: 3, flexWrap: "wrap", alignItems: "center" }}>
        <Chip
          label={run.id}
          size="small"
          variant="outlined"
          sx={{ fontFamily: "monospace", fontSize: "0.75rem" }}
        />
        <Typography variant="body2" color="text.secondary">
          Started {timeAgo(run.started_at ?? run.created_at)}
        </Typography>
        {(run.started_at || run.created_at) && (
          <Typography variant="body2" color="text.secondary">
            Duration: {formatDuration(run.started_at ?? run.created_at, run.completed_at)}
          </Typography>
        )}
      </Box>

      {/* ── Step Timeline ── */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 600, mb: 2, fontSize: "1rem" }}>
          Steps
        </Typography>

        {run.steps.length === 0 ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1, py: 2 }}>
            <Skeleton variant="rectangular" height={40} animation="pulse" />
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
              {run.status === "pending" ? "Waiting to start…" : "No steps recorded."}
            </Typography>
          </Box>
        ) : (
          <Stepper orientation="vertical" nonLinear activeStep={-1}>
            {run.steps.map((step) => {
              const node = nodeMap.get(step.node_id);
              const nodeName = node?.name ?? step.node_id;
              const nodeType = node?.type ?? "unknown";
              const isOpen = openStep === step.id;

              return (
                <Step key={step.id} expanded={isOpen} completed={step.status === "completed"}>
                  <StepLabel
                    icon={<StepStatusIcon status={step.status} />}
                    onClick={() => toggleStep(step.id)}
                    sx={{ cursor: "pointer" }}
                  >
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography sx={{ fontWeight: 500 }}>{nodeName}</Typography>
                      <Chip
                        label={nodeType}
                        size="small"
                        variant="outlined"
                        color={NODE_TYPE_COLOR[nodeType] ?? "default"}
                        sx={{ fontSize: "0.7rem", height: 20 }}
                      />
                      {step.agent_version != null && (
                        <Chip
                          label={`agent v${step.agent_version}`}
                          size="small"
                          variant="filled"
                          color="secondary"
                          title={step.anthropic_agent_id ?? undefined}
                          sx={{ fontSize: "0.7rem", height: 20 }}
                        />
                      )}
                      {step.completed_at && step.started_at && (
                        <Typography variant="caption" color="text.secondary">
                          {formatDuration(step.started_at, step.completed_at)}
                        </Typography>
                      )}
                      {step.status === "running" && (
                        <Typography variant="caption" color="info.main" sx={{ fontWeight: 500 }}>
                          running…
                        </Typography>
                      )}
                    </Box>
                  </StepLabel>
                  <StepContent>
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, py: 1 }}>
                      {/* Step timing */}
                      <Box sx={{ display: "flex", gap: 2 }}>
                        <Typography variant="caption" color="text.secondary">
                          Started: {new Date(step.started_at).toLocaleTimeString()}
                        </Typography>
                        {step.completed_at && (
                          <Typography variant="caption" color="text.secondary">
                            Ended: {new Date(step.completed_at).toLocaleTimeString()}
                          </Typography>
                        )}
                      </Box>

                      {/* Managed-agent provenance */}
                      {(step.agent_version != null ||
                        step.anthropic_agent_id ||
                        step.agent_session_id) && (
                        <Box
                          sx={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 0.25,
                            fontFamily: "monospace",
                            fontSize: "0.75rem",
                            color: "text.secondary",
                            bgcolor: "action.hover",
                            borderRadius: 1,
                            p: 1,
                          }}
                        >
                          {step.agent_version != null && (
                            <span>agent version: v{step.agent_version}</span>
                          )}
                          {step.anthropic_agent_id && (
                            <span>anthropic agent id: {step.anthropic_agent_id}</span>
                          )}
                          {step.agent_session_id && (
                            <span>session id: {step.agent_session_id}</span>
                          )}
                        </Box>
                      )}

                      {/* Input JSON */}
                      {step.input_json && (
                        <JsonBlock value={step.input_json} label="Input" />
                      )}

                      {/* Output — delegate to AgentOutputView */}
                      <AgentOutputView step={step} nodeType={nodeType} />
                    </Box>
                  </StepContent>
                </Step>
              );
            })}
          </Stepper>
        )}
      </Paper>

      {/* ── Event Log ── */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 600, mb: 1, fontSize: "1rem" }}>
          Event Log
        </Typography>
        <Divider sx={{ mb: 1 }} />
        <EventLogTable events={run.events} />
      </Paper>
    </Box>
  );
}
