import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Skeleton from "@mui/material/Skeleton";
import Button from "@mui/material/Button";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PlaylistPlayIcon from "@mui/icons-material/PlaylistPlay";
import { listRuns } from "../api/runs";
import { useInterval } from "../hooks/useInterval";
import RunStatusChip from "../components/run/RunStatusChip";
import type { RunSummary } from "../types";

/**
 * Compute human-readable relative time string.
 */
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function RunListPage() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    try {
      const data = await listRuns();
      setRuns(data.runs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load runs");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  // Poll every 5s while any run is active
  const hasActive = runs.some(
    (r) => r.status === "pending" || r.status === "running"
  );
  useInterval(fetchRuns, hasActive ? 5000 : null);

  // Loading state
  if (loading) {
    return (
      <Box data-testid="runs-page-root" sx={{ p: 3 }}>
        <Skeleton variant="rectangular" height={40} sx={{ mb: 2 }} animation="pulse" />
        {[...Array(5)].map((_, i) => (
          <Skeleton
            key={i}
            variant="rectangular"
            height={48}
            sx={{ mb: 0.5 }}
            animation="pulse"
          />
        ))}
      </Box>
    );
  }

  // Empty state
  if (!error && runs.length === 0) {
    return (
      <Box
        data-testid="runs-page-root"
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          gap: 2,
        }}
      >
        <Paper elevation={0} sx={{ p: 4, textAlign: "center", maxWidth: 440 }}>
          <PlaylistPlayIcon sx={{ fontSize: 48, color: "text.secondary", mb: 1 }} />
          <Typography variant="h5" sx={{ fontWeight: 600, mb: 1 }}>
            No Runs Yet
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
            Start a workflow from the editor to create your first run.
          </Typography>
          <Button
            variant="outlined"
            startIcon={<ArrowBackIcon />}
            onClick={() => navigate("/")}
          >
            Back to Editor
          </Button>
        </Paper>
      </Box>
    );
  }

  return (
    <Box data-testid="runs-page-root" sx={{ p: 3, height: "100%", overflow: "auto" }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          mb: 2,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Button
            size="small"
            startIcon={<ArrowBackIcon />}
            onClick={() => navigate("/")}
          >
            Editor
          </Button>
          <Typography variant="h5" sx={{ fontWeight: 600 }}>
            Run History
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary">
          {runs.length} run{runs.length !== 1 ? "s" : ""}
          {hasActive && " · auto-refreshing"}
        </Typography>
      </Box>

      {error && (
        <Paper
          sx={{
            p: 2,
            mb: 2,
            bgcolor: "error.light",
            color: "error.contrastText",
          }}
        >
          {error}
        </Paper>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>Run ID</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Workflow</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Started</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {runs.map((run) => (
              <TableRow
                key={run.id}
                hover
                onClick={() => navigate(`/runs/${run.id}`)}
                sx={{ cursor: "pointer" }}
              >
                <TableCell
                  sx={{
                    fontFamily: "monospace",
                    fontSize: "0.8rem",
                    maxWidth: 160,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {run.id}
                </TableCell>
                <TableCell>{run.workflowName}</TableCell>
                <TableCell>
                  <RunStatusChip status={run.status} />
                </TableCell>
                <TableCell sx={{ color: "text.secondary", fontSize: "0.85rem" }}>
                  {timeAgo(run.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
