import { useEffect, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import Box from "@mui/material/Box";
import { listWorkflows, getWorkflow, type WorkflowListItem } from "../api/workflows";
import type { WorkflowSchema } from "./types";

interface LoadWorkflowDialogProps {
  open: boolean;
  onClose: () => void;
  onLoad: (data: { id: string; name: string; schema: WorkflowSchema }) => void;
}

export default function LoadWorkflowDialog({ open, onClose, onLoad }: LoadWorkflowDialogProps) {
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    listWorkflows()
      .then(setWorkflows)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [open]);

  const handleSelect = async (item: WorkflowListItem) => {
    try {
      const data = await getWorkflow(item.id);
      onLoad(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workflow");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Load Workflow</DialogTitle>
      <DialogContent>
        {loading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
            <CircularProgress size={28} />
          </Box>
        )}
        {error && (
          <Typography color="error" sx={{ py: 1 }}>
            {error}
          </Typography>
        )}
        {!loading && !error && workflows.length === 0 && (
          <Typography color="text.secondary" sx={{ py: 2, textAlign: "center" }}>
            No saved workflows found.
          </Typography>
        )}
        {!loading && workflows.length > 0 && (
          <List>
            {workflows.map((wf) => (
              <ListItemButton key={wf.id} onClick={() => handleSelect(wf)}>
                <ListItemText
                  primary={wf.name}
                  secondary={`ID: ${wf.id} | Created: ${new Date(wf.created_at).toLocaleString()}`}
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </DialogContent>
    </Dialog>
  );
}
