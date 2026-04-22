import { useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { startRun } from "../api/runs";

interface RunInputDialogProps {
  open: boolean;
  onClose: () => void;
  workflowId: string;
  requiredFields: string[];
  onRunStarted: (runId: string) => void;
}

export default function RunInputDialog({
  open,
  onClose,
  workflowId,
  requiredFields,
  onRunStarted,
}: RunInputDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFieldChange = (field: string, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  };

  const allFilled = requiredFields.every(
    (f) => (values[f] ?? "").trim() !== ""
  );

  const handleSubmit = async () => {
    if (!allFilled) return;
    setSubmitting(true);
    setError(null);

    try {
      const result = await startRun(workflowId, values);
      onRunStarted(result.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start run");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (submitting) return; // don't close while submitting
    setValues({});
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <PlayArrowIcon color="primary" />
        Run Workflow
      </DialogTitle>
      <DialogContent>
        {requiredFields.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 1 }}>
            This workflow has no required input fields. Click Run to start.
          </Typography>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Provide values for the required input fields:
            </Typography>
            {requiredFields.map((field) => (
              <TextField
                key={field}
                label={field}
                size="small"
                fullWidth
                value={values[field] ?? ""}
                onChange={(e) => handleFieldChange(field, e.target.value)}
                disabled={submitting}
              />
            ))}
          </Box>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={!allFilled || submitting}
          startIcon={
            submitting ? <CircularProgress size={16} /> : <PlayArrowIcon />
          }
        >
          {submitting ? "Starting..." : "Run"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
