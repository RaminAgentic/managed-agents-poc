import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import PlaylistPlayIcon from "@mui/icons-material/PlaylistPlay";

export default function RunListPage() {
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
        <PlaylistPlayIcon sx={{ fontSize: 48, color: "text.secondary", mb: 1 }} />
        <Typography variant="h5" sx={{ fontWeight: 600, mb: 1 }}>
          Workflow Runs
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Run history will appear here. Start a workflow from the editor to create your first run.
        </Typography>
      </Paper>
    </Box>
  );
}
