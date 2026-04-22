import { useState, useCallback, useEffect, useRef } from "react";
import type { Node } from "@xyflow/react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import IconButton from "@mui/material/IconButton";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import CloseIcon from "@mui/icons-material/Close";
import type {
  WorkflowNodeData,
  InputNodeConfig,
  AgentNodeConfig,
  HumanGateNodeConfig,
  ModelConfig,
} from "./types";

interface InspectorProps {
  node: Node;
  updateNodeData: (nodeId: string, patch: Partial<WorkflowNodeData>) => void;
  onClose: () => void;
}

// ── Debounced text field ──────────────────────────────────────────

function DebouncedTextField({
  value,
  onChange,
  delay = 150,
  ...props
}: {
  value: string;
  onChange: (val: string) => void;
  delay?: number;
} & Omit<React.ComponentProps<typeof TextField>, "onChange" | "value">) {
  const [local, setLocal] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setLocal(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(v), delay);
  };

  return <TextField {...props} value={local} onChange={handleChange} />;
}

// ── Per-type inspectors ───────────────────────────────────────────

function InputInspector({
  config,
  onConfigChange,
}: {
  config: InputNodeConfig;
  onConfigChange: (patch: Partial<InputNodeConfig>) => void;
}) {
  const [newField, setNewField] = useState("");

  const addField = () => {
    const trimmed = newField.trim();
    if (!trimmed) return;
    const current = config.requiredFields ?? [];
    if (!current.includes(trimmed)) {
      onConfigChange({ requiredFields: [...current, trimmed] });
    }
    setNewField("");
  };

  const removeField = (field: string) => {
    onConfigChange({
      requiredFields: (config.requiredFields ?? []).filter((f) => f !== field),
    });
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Typography variant="subtitle2" color="text.secondary">Required Fields</Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
        {(config.requiredFields ?? []).map((field) => (
          <Chip
            key={field}
            label={field}
            size="small"
            onDelete={() => removeField(field)}
          />
        ))}
      </Box>
      <Box sx={{ display: "flex", gap: 0.5 }}>
        <TextField
          size="small"
          placeholder="Add field..."
          value={newField}
          onChange={(e) => setNewField(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addField(); }}}
          sx={{ flex: 1 }}
        />
      </Box>
    </Box>
  );
}

function AgentInspector({
  config,
  modelConfig,
  onConfigChange,
  onModelConfigChange,
}: {
  config: AgentNodeConfig;
  modelConfig?: ModelConfig;
  onConfigChange: (patch: Partial<AgentNodeConfig>) => void;
  onModelConfigChange: (patch: Partial<ModelConfig>) => void;
}) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <DebouncedTextField
        label="Instructions"
        multiline
        minRows={3}
        maxRows={8}
        size="small"
        value={config.instructions ?? ""}
        onChange={(val) => onConfigChange({ instructions: val })}
      />
      <DebouncedTextField
        label="Agent Ref"
        size="small"
        value={config.agentRef ?? ""}
        onChange={(val) => onConfigChange({ agentRef: val })}
        placeholder="e.g. research-agent"
      />
      <FormControl size="small">
        <InputLabel>Effort</InputLabel>
        <Select
          label="Effort"
          value={modelConfig?.effort ?? "xhigh"}
          onChange={(e) => onModelConfigChange({ effort: e.target.value as ModelConfig["effort"] })}
        >
          <MenuItem value="low">Low</MenuItem>
          <MenuItem value="medium">Medium</MenuItem>
          <MenuItem value="high">High</MenuItem>
          <MenuItem value="xhigh">XHigh</MenuItem>
          <MenuItem value="max">Max</MenuItem>
        </Select>
      </FormControl>
      <DebouncedTextField
        label="Timeout (seconds)"
        type="number"
        size="small"
        value={String(config.timeoutSeconds ?? 300)}
        onChange={(val) => onConfigChange({ timeoutSeconds: parseInt(val) || 300 })}
      />
      <DebouncedTextField
        label="Input Mapping (JSON)"
        multiline
        minRows={2}
        maxRows={6}
        size="small"
        value={JSON.stringify(config.inputMapping ?? {}, null, 2)}
        onChange={(val) => {
          try {
            onConfigChange({ inputMapping: JSON.parse(val) });
          } catch {
            // Invalid JSON — ignore until valid
          }
        }}
      />
    </Box>
  );
}

function HumanGateInspector({
  config,
  onConfigChange,
}: {
  config: HumanGateNodeConfig;
  onConfigChange: (patch: Partial<HumanGateNodeConfig>) => void;
}) {
  const [newValue, setNewValue] = useState("");

  const addDecisionValue = () => {
    const trimmed = newValue.trim();
    if (!trimmed) return;
    const current = config.decisionValues ?? [];
    if (!current.includes(trimmed)) {
      onConfigChange({ decisionValues: [...current, trimmed] });
    }
    setNewValue("");
  };

  const removeDecisionValue = (val: string) => {
    onConfigChange({
      decisionValues: (config.decisionValues ?? []).filter((v) => v !== val),
    });
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <DebouncedTextField
        label="Channel"
        size="small"
        value={config.channel ?? ""}
        onChange={(val) => onConfigChange({ channel: val })}
      />
      <DebouncedTextField
        label="Message Template"
        multiline
        minRows={2}
        maxRows={6}
        size="small"
        value={config.messageTemplate ?? ""}
        onChange={(val) => onConfigChange({ messageTemplate: val })}
      />
      <Typography variant="subtitle2" color="text.secondary">Decision Values</Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
        {(config.decisionValues ?? []).map((val) => (
          <Chip
            key={val}
            label={val}
            size="small"
            onDelete={() => removeDecisionValue(val)}
          />
        ))}
      </Box>
      <Box sx={{ display: "flex", gap: 0.5 }}>
        <TextField
          size="small"
          placeholder="Add value..."
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDecisionValue(); }}}
          sx={{ flex: 1 }}
        />
      </Box>
    </Box>
  );
}

function FinalizeInspector() {
  return (
    <Box sx={{ py: 1 }}>
      <Typography variant="body2" color="text.secondary">
        No editable fields. This node marks the end of the workflow.
      </Typography>
    </Box>
  );
}

// ── Main Inspector ────────────────────────────────────────────────

export default function Inspector({ node, updateNodeData, onClose }: InspectorProps) {
  const data = node.data as unknown as WorkflowNodeData;
  const nodeType = data.nodeType;

  const handleNameChange = useCallback(
    (name: string) => {
      updateNodeData(node.id, { name });
    },
    [node.id, updateNodeData]
  );

  const handleConfigChange = useCallback(
    (patch: Record<string, unknown>) => {
      updateNodeData(node.id, {
        config: { ...data.config, ...patch },
      });
    },
    [node.id, data.config, updateNodeData]
  );

  const handleModelConfigChange = useCallback(
    (patch: Partial<ModelConfig>) => {
      updateNodeData(node.id, {
        modelConfig: { ...(data.modelConfig ?? {}), ...patch },
      });
    },
    [node.id, data.modelConfig, updateNodeData]
  );

  const typeColors: Record<string, string> = {
    input: "#2196f3",
    agent: "#7c4dff",
    human_gate: "#ed6c02",
    finalize: "#2e7d32",
  };

  return (
    <Box
      sx={{
        width: 320,
        borderLeft: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        overflow: "auto",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box sx={{ p: 1.5, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, color: typeColors[nodeType] ?? "text.primary" }}>
          {nodeType.replace("_", " ").toUpperCase()} Inspector
        </Typography>
        <IconButton size="small" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      <Divider />
      <Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 2 }}>
        <DebouncedTextField
          label="Node Name"
          size="small"
          value={data.name ?? ""}
          onChange={handleNameChange}
        />
        <Divider />
        {nodeType === "input" && (
          <InputInspector
            config={data.config as InputNodeConfig}
            onConfigChange={handleConfigChange}
          />
        )}
        {nodeType === "agent" && (
          <AgentInspector
            config={data.config as AgentNodeConfig}
            modelConfig={data.modelConfig}
            onConfigChange={handleConfigChange}
            onModelConfigChange={handleModelConfigChange}
          />
        )}
        {nodeType === "human_gate" && (
          <HumanGateInspector
            config={data.config as HumanGateNodeConfig}
            onConfigChange={handleConfigChange}
          />
        )}
        {nodeType === "finalize" && <FinalizeInspector />}
      </Box>
    </Box>
  );
}
