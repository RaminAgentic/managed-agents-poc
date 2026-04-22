import { useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Chip from "@mui/material/Chip";
import MonitorHeartIcon from "@mui/icons-material/MonitorHeart";

export default function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>();

  return (
    <Box
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
        <MonitorHeartIcon sx={{ fontSize: 48, color: "primary.main", mb: 1 }} />
        <Typography variant="h5" sx={{ fontWeight: 600, mb: 1 }}>
          Run Detail
        </Typography>
        <Chip label={runId ?? "unknown"} size="small" sx={{ mb: 2, fontFamily: "monospace" }} />
        <Typography variant="body1" color="text.secondary">
          Live run monitoring will be built in Sprint 9. The run has been submitted to the executor.
        </Typography>
      </Paper>
    </Box>
  );
}
