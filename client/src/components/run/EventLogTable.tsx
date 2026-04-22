import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import type { RunEvent } from "../../types";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString();
}

function summarizePayload(raw: string): string {
  try {
    const obj = JSON.parse(raw);
    const str = JSON.stringify(obj);
    return str.length > 80 ? str.slice(0, 77) + "…" : str;
  } catch {
    return raw.length > 80 ? raw.slice(0, 77) + "…" : raw;
  }
}

const EVENT_COLOR: Record<string, "default" | "info" | "success" | "error" | "warning"> = {
  workflow_started: "info",
  workflow_completed: "success",
  step_started: "info",
  step_completed: "success",
  step_failed: "error",
  error: "error",
  max_steps_exceeded: "warning",
  server_restart: "warning",
};

interface EventLogTableProps {
  events: RunEvent[];
}

export default function EventLogTable({ events }: EventLogTableProps) {
  if (events.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: "center" }}>
        No events recorded yet.
      </Typography>
    );
  }

  return (
    <TableContainer sx={{ maxHeight: 300 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 600, width: 100 }}>Time</TableCell>
            <TableCell sx={{ fontWeight: 600, width: 160 }}>Event</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Details</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {events.map((evt) => (
            <TableRow key={evt.id} hover>
              <TableCell sx={{ fontFamily: "monospace", fontSize: "0.75rem" }}>
                {formatTime(evt.created_at)}
              </TableCell>
              <TableCell>
                <Chip
                  label={evt.event_type}
                  size="small"
                  variant="outlined"
                  color={EVENT_COLOR[evt.event_type] ?? "default"}
                  sx={{ fontSize: "0.7rem" }}
                />
              </TableCell>
              <TableCell
                sx={{
                  fontFamily: "monospace",
                  fontSize: "0.7rem",
                  color: "text.secondary",
                  maxWidth: 400,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {summarizePayload(evt.payload)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
