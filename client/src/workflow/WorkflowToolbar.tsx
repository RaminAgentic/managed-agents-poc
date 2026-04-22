import { useState, useMemo } from "react";
import type { Node, Edge } from "@xyflow/react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import Collapse from "@mui/material/Collapse";
import Snackbar from "@mui/material/Snackbar";
import SaveIcon from "@mui/icons-material/Save";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import AddIcon from "@mui/icons-material/Add";
import { validateWorkflow } from "./validate";
import { serializeWorkflow } from "./serialize";
import { saveWorkflow } from "../api/workflows";
import LoadWorkflowDialog from "./LoadWorkflowDialog";
import { deserializeWorkflow } from "./serialize";

interface WorkflowToolbarProps {
  nodes: Node[];
  edges: Edge[];
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
}

export default function WorkflowToolbar({ nodes, edges, setNodes, setEdges }: WorkflowToolbarProps) {
  const [workflowName, setWorkflowName] = useState("");
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ open: boolean; message: string; severity: "success" | "error" }>({
    open: false,
    message: "",
    severity: "success",
  });
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);

  const validation = useMemo(() => validateWorkflow(nodes, edges), [nodes, edges]);

  const canSave = validation.ok && workflowName.trim() !== "" && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const schema = serializeWorkflow(nodes, edges, {
        id: workflowId ?? undefined,
        name: workflowName.trim(),
      });
      const result = await saveWorkflow(schema, workflowName.trim());
      setWorkflowId(result.id);
      setToast({ open: true, message: `Workflow saved: ${result.name}`, severity: "success" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setToast({ open: true, message, severity: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleLoad = (loaded: { id: string; name: string; schema: import("./types").WorkflowSchema }) => {
    const { nodes: newNodes, edges: newEdges } = deserializeWorkflow(loaded.schema);
    setNodes(newNodes);
    setEdges(newEdges);
    setWorkflowName(loaded.name);
    setWorkflowId(loaded.id);
    setLoadDialogOpen(false);
    setToast({ open: true, message: `Loaded: ${loaded.name}`, severity: "success" });
  };

  const handleNew = () => {
    if (nodes.length > 0) {
      const confirmed = window.confirm("Discard unsaved changes and start a new workflow?");
      if (!confirmed) return;
    }
    setNodes([]);
    setEdges([]);
    setWorkflowName("");
    setWorkflowId(null);
  };

  return (
    <>
      <Box sx={{ borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
        <Stack direction="row" spacing={1} sx={{ p: 1, alignItems: "center" }}>
          <TextField
            size="small"
            placeholder="Workflow name..."
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
            sx={{ width: 220 }}
          />
          <Button
            variant="contained"
            size="small"
            startIcon={<SaveIcon />}
            disabled={!canSave}
            onClick={handleSave}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={<FolderOpenIcon />}
            onClick={() => setLoadDialogOpen(true)}
          >
            Load
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={<AddIcon />}
            onClick={handleNew}
          >
            New
          </Button>
        </Stack>
        <Collapse in={!validation.ok && nodes.length > 0}>
          <Alert severity="error" sx={{ mx: 1, mb: 1 }}>
            {validation.errors.map((err, i) => (
              <div key={i}>{err}</div>
            ))}
          </Alert>
        </Collapse>
      </Box>

      <LoadWorkflowDialog
        open={loadDialogOpen}
        onClose={() => setLoadDialogOpen(false)}
        onLoad={handleLoad}
      />

      <Snackbar
        open={toast.open}
        autoHideDuration={4000}
        onClose={() => setToast((t) => ({ ...t, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={toast.severity} onClose={() => setToast((t) => ({ ...t, open: false }))}>
          {toast.message}
        </Alert>
      </Snackbar>
    </>
  );
}
