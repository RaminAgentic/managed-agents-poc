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
import Button from "@mui/material/Button";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import type {
  WorkflowNodeData,
  InputNodeConfig,
  AgentNodeConfig,
  AgentMcpServer,
  AgentTool,
  AgentSkill,
  HumanGateNodeConfig,
  ModelConfig,
} from "./types";

// ── Known MCP server catalog (matches server-side MCP tool description) ──
const KNOWN_MCP_SERVERS: Array<{ name: string; url: string; label: string }> = [
  { name: "slack",      label: "Slack",           url: "https://mcp.slack.com/mcp" },
  { name: "salesforce", label: "Salesforce",      url: "https://mcp.salesforce.com/mcp" },
  { name: "linear",     label: "Linear",          url: "https://mcp.linear.app/mcp" },
  { name: "sentry",     label: "Sentry",          url: "https://mcp.sentry.dev/mcp" },
  { name: "notion",     label: "Notion",          url: "https://mcp.notion.com/mcp" },
  { name: "github",     label: "GitHub",          url: "https://api.githubcopilot.com/mcp/" },
  { name: "atlassian",  label: "Atlassian",       url: "https://mcp.atlassian.com/v1/sse" },
];

const KNOWN_SKILLS: Array<{ id: string; label: string }> = [
  { id: "docx", label: "docx — Word documents" },
  { id: "xlsx", label: "xlsx — Spreadsheets" },
  { id: "pdf",  label: "pdf — PDFs" },
  { id: "pptx", label: "pptx — PowerPoint" },
];

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

function McpServersEditor({
  servers,
  onChange,
}: {
  servers: AgentMcpServer[];
  onChange: (next: AgentMcpServer[]) => void;
}) {
  const [picker, setPicker] = useState("");

  const addFromPicker = () => {
    if (!picker) return;
    const known = KNOWN_MCP_SERVERS.find((s) => s.name === picker);
    if (!known) return;
    if (servers.some((s) => s.name === known.name)) {
      setPicker("");
      return;
    }
    onChange([...servers, { name: known.name, type: "url", url: known.url }]);
    setPicker("");
  };

  const remove = (name: string) => {
    onChange(servers.filter((s) => s.name !== name));
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
        {servers.length === 0 && (
          <Typography variant="caption" color="text.disabled">
            No MCP servers attached.
          </Typography>
        )}
        {servers.map((s) => (
          <Chip
            key={s.name}
            label={s.name}
            size="small"
            onDelete={() => remove(s.name)}
          />
        ))}
      </Box>
      <Box sx={{ display: "flex", gap: 0.5 }}>
        <FormControl size="small" sx={{ flex: 1 }}>
          <InputLabel>Add MCP server</InputLabel>
          <Select
            label="Add MCP server"
            value={picker}
            onChange={(e) => setPicker(e.target.value as string)}
          >
            <MenuItem value="">
              <em>— pick one —</em>
            </MenuItem>
            {KNOWN_MCP_SERVERS.map((s) => (
              <MenuItem
                key={s.name}
                value={s.name}
                disabled={servers.some((x) => x.name === s.name)}
              >
                {s.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button
          variant="outlined"
          size="small"
          disabled={!picker}
          onClick={addFromPicker}
        >
          Add
        </Button>
      </Box>
    </Box>
  );
}

function SkillsEditor({
  skills,
  onChange,
}: {
  skills: AgentSkill[];
  onChange: (next: AgentSkill[]) => void;
}) {
  const [picker, setPicker] = useState("");

  const addFromPicker = () => {
    if (!picker) return;
    if (skills.some((s) => s.skill_id === picker)) {
      setPicker("");
      return;
    }
    onChange([...skills, { type: "anthropic", skill_id: picker }]);
    setPicker("");
  };

  const remove = (skillId: string) => {
    onChange(skills.filter((s) => s.skill_id !== skillId));
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
        {skills.length === 0 && (
          <Typography variant="caption" color="text.disabled">
            No skills attached.
          </Typography>
        )}
        {skills.map((s) => (
          <Chip
            key={s.skill_id}
            label={s.skill_id}
            size="small"
            onDelete={() => remove(s.skill_id)}
          />
        ))}
      </Box>
      <Box sx={{ display: "flex", gap: 0.5 }}>
        <FormControl size="small" sx={{ flex: 1 }}>
          <InputLabel>Add skill</InputLabel>
          <Select
            label="Add skill"
            value={picker}
            onChange={(e) => setPicker(e.target.value as string)}
          >
            <MenuItem value="">
              <em>— pick one —</em>
            </MenuItem>
            {KNOWN_SKILLS.map((s) => (
              <MenuItem
                key={s.id}
                value={s.id}
                disabled={skills.some((x) => x.skill_id === s.id)}
              >
                {s.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button
          variant="outlined"
          size="small"
          disabled={!picker}
          onClick={addFromPicker}
        >
          Add
        </Button>
      </Box>
    </Box>
  );
}

function ToolsEditor({
  tools,
  mcpServers,
  onChange,
}: {
  tools: AgentTool[];
  mcpServers: AgentMcpServer[];
  onChange: (next: AgentTool[]) => void;
}) {
  const hasBaseToolset = tools.some(
    (t) => t.type === "agent_toolset_20260401"
  );
  const attachedMcpToolsets = new Set(
    tools
      .filter((t) => t.type === "mcp_toolset" && t.mcp_server_name)
      .map((t) => t.mcp_server_name as string)
  );

  const toggleBaseToolset = () => {
    if (hasBaseToolset) {
      onChange(tools.filter((t) => t.type !== "agent_toolset_20260401"));
    } else {
      onChange([...tools, { type: "agent_toolset_20260401" }]);
    }
  };

  const toggleMcpToolset = (serverName: string) => {
    if (attachedMcpToolsets.has(serverName)) {
      onChange(
        tools.filter(
          (t) =>
            !(
              t.type === "mcp_toolset" && t.mcp_server_name === serverName
            )
        )
      );
    } else {
      onChange([
        ...tools,
        {
          type: "mcp_toolset",
          mcp_server_name: serverName,
          default_config: {
            permission_policy: { type: "always_allow" },
          },
        },
      ]);
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
      <Chip
        label="agent_toolset_20260401 (base)"
        size="small"
        color={hasBaseToolset ? "primary" : "default"}
        variant={hasBaseToolset ? "filled" : "outlined"}
        onClick={toggleBaseToolset}
        sx={{ alignSelf: "flex-start" }}
      />
      {mcpServers.length === 0 ? (
        <Typography variant="caption" color="text.disabled">
          Attach MCP servers above to enable their toolsets.
        </Typography>
      ) : (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          {mcpServers.map((s) => {
            const active = attachedMcpToolsets.has(s.name);
            return (
              <Chip
                key={s.name}
                label={`mcp_toolset: ${s.name}`}
                size="small"
                color={active ? "primary" : "default"}
                variant={active ? "filled" : "outlined"}
                onClick={() => toggleMcpToolset(s.name)}
              />
            );
          })}
        </Box>
      )}
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
  const mcpServers = config.mcpServers ?? [];
  const tools = config.tools ?? [];
  const skills = config.skills ?? [];

  // When MCP servers are removed, drop any orphan mcp_toolset entries
  const pruneToolsForServers = (nextServers: AgentMcpServer[]) => {
    const liveNames = new Set(nextServers.map((s) => s.name));
    const prunedTools = tools.filter(
      (t) =>
        !(
          t.type === "mcp_toolset" &&
          t.mcp_server_name &&
          !liveNames.has(t.mcp_server_name)
        )
    );
    onConfigChange({
      mcpServers: nextServers,
      tools: prunedTools.length === tools.length ? tools : prunedTools,
    });
  };

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

      <Accordion
        disableGutters
        defaultExpanded={mcpServers.length > 0 || skills.length > 0}
        sx={{
          boxShadow: "none",
          border: 1,
          borderColor: "divider",
          "&:before": { display: "none" },
        }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />}>
          <Typography variant="subtitle2">Managed agent</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ display: "flex", flexDirection: "column", gap: 1.5, pt: 0 }}>
          <Typography variant="caption" color="text.secondary">
            MCP servers
          </Typography>
          <McpServersEditor
            servers={mcpServers}
            onChange={pruneToolsForServers}
          />
          <Typography variant="caption" color="text.secondary">
            Toolsets
          </Typography>
          <ToolsEditor
            tools={tools}
            mcpServers={mcpServers}
            onChange={(next) => onConfigChange({ tools: next })}
          />
          <Typography variant="caption" color="text.secondary">
            Skills
          </Typography>
          <SkillsEditor
            skills={skills}
            onChange={(next) => onConfigChange({ skills: next })}
          />
        </AccordionDetails>
      </Accordion>

      <Accordion
        disableGutters
        sx={{
          boxShadow: "none",
          border: 1,
          borderColor: "divider",
          "&:before": { display: "none" },
        }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />}>
          <Typography variant="subtitle2">Advanced</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ display: "flex", flexDirection: "column", gap: 1.5, pt: 0 }}>
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
        </AccordionDetails>
      </Accordion>
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
