/**
 * Agent Registry — versioned, append-only tracking of managed-agent
 * configurations per (workflow, node) pair.
 *
 * Whenever a workflow agent node is about to execute, the registry
 * resolves (or creates) the corresponding `Agent` DB row and its
 * associated Anthropic managed-agent resource.
 *
 * Key behaviors:
 * - Dedupe by config hash: identical configs for the same node reuse
 *   the same Anthropic agent (no matter how many times it's edited
 *   and reverted).
 * - Monotonic versions: each *distinct* config seen for a node gets
 *   the next version number. Old rows are kept forever.
 * - Single active version: at most one `Agent` row per (workflow, node)
 *   has `supersededAt = NULL` at any given time.
 *
 * The hash only covers fields that change the Anthropic agent's
 * identity (instructions, model, mcp_servers, tools, skills). Fields
 * like inputMapping, timeoutSeconds, outputFormat are execution-time
 * concerns and don't warrant new agent versions.
 */
import crypto from "crypto";
import type Anthropic from "@anthropic-ai/sdk";
import prisma from "../db/client";
import { anthropic } from "../config/anthropic";
import type { AgentNodeConfig, ModelConfig, AgentTool } from "./types";
import { SF_TOOL_DEFINITIONS } from "../tools/salesforce";

/**
 * Expand shorthand flags (e.g. includeSalesforceTools) into full
 * tool definitions. Called at registration time so the resulting
 * config is exactly what Anthropic receives.
 */
function expandTools(config: AgentNodeConfig): AgentTool[] | undefined {
  const base = (config.tools ?? []).slice();
  if (config.includeSalesforceTools) {
    for (const t of SF_TOOL_DEFINITIONS) {
      base.push(t as unknown as AgentTool);
    }
  }
  return base.length > 0 ? base : undefined;
}

const DEFAULT_MODEL = "claude-opus-4-7";

/**
 * The subset of config fields that define an Anthropic agent's identity.
 * Two nodes with the same identity config share one Anthropic agent.
 */
interface AgentIdentity {
  instructions: string;
  model?: string;
  mcpServers?: AgentNodeConfig["mcpServers"];
  tools?: AgentNodeConfig["tools"];
  skills?: AgentNodeConfig["skills"];
}

function buildIdentity(
  config: AgentNodeConfig,
  modelConfig?: ModelConfig
): AgentIdentity {
  const identity: AgentIdentity = { instructions: config.instructions };
  if (modelConfig?.model) identity.model = modelConfig.model;
  if (config.mcpServers && config.mcpServers.length > 0) {
    identity.mcpServers = config.mcpServers;
  }
  const expandedTools = expandTools(config);
  if (expandedTools && expandedTools.length > 0) {
    identity.tools = expandedTools;
  }
  if (config.skills && config.skills.length > 0) {
    identity.skills = config.skills;
  }
  return identity;
}

/** Deterministic JSON stringify — sorts object keys at every level. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]))
      .join(",") +
    "}"
  );
}

function hashIdentity(identity: AgentIdentity): string {
  return crypto
    .createHash("sha256")
    .update(stableStringify(identity))
    .digest("hex");
}

export interface ResolvedAgent {
  /** Agent DB row id (use for FK on RunStep). */
  id: string;
  /** Anthropic-side agent id (use for beta.sessions.create). */
  anthropicAgentId: string;
  /** Monotonic version number for this (workflowId, nodeId). */
  version: number;
}

/**
 * Resolve the active `Agent` row for a workflow node, creating a new
 * version (and a new Anthropic agent) if the config has changed.
 *
 * Race-safe: if a parallel call inserts first, the retry path finds
 * the existing row and reuses it.
 */
export async function findOrCreateAgent(params: {
  workflowId: string;
  nodeId: string;
  nodeName: string;
  config: AgentNodeConfig;
  modelConfig?: ModelConfig;
}): Promise<ResolvedAgent> {
  const { workflowId, nodeId, nodeName, config, modelConfig } = params;
  const identity = buildIdentity(config, modelConfig);
  const configHash = hashIdentity(identity);

  const existing = await prisma.agent.findUnique({
    where: {
      workflowId_nodeId_configHash: { workflowId, nodeId, configHash },
    },
  });

  if (existing) {
    if (existing.supersededAt) {
      await prisma.$transaction([
        prisma.agent.updateMany({
          where: { workflowId, nodeId, supersededAt: null },
          data: { supersededAt: new Date() },
        }),
        prisma.agent.update({
          where: { id: existing.id },
          data: { supersededAt: null },
        }),
      ]);
    }
    return {
      id: existing.id,
      anthropicAgentId: existing.anthropicAgentId,
      version: existing.version,
    };
  }

  const anthropicAgent = await createAnthropicAgent({
    name: `${nodeName} (${nodeId})`.slice(0, 100),
    model: modelConfig?.model ?? DEFAULT_MODEL,
    instructions: config.instructions,
    mcpServers: config.mcpServers,
    tools: expandTools(config),
    skills: config.skills,
  });

  const latest = await prisma.agent.findFirst({
    where: { workflowId, nodeId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const nextVersion = (latest?.version ?? 0) + 1;

  try {
    const [, inserted] = await prisma.$transaction([
      prisma.agent.updateMany({
        where: { workflowId, nodeId, supersededAt: null },
        data: { supersededAt: new Date() },
      }),
      prisma.agent.create({
        data: {
          workflowId,
          nodeId,
          version: nextVersion,
          configHash,
          configJson: JSON.stringify(identity),
          anthropicAgentId: anthropicAgent.id,
        },
      }),
    ]);
    return {
      id: inserted.id,
      anthropicAgentId: inserted.anthropicAgentId,
      version: inserted.version,
    };
  } catch (err: unknown) {
    // Race: another caller inserted the same configHash first. Refetch.
    const raced = await prisma.agent.findUnique({
      where: {
        workflowId_nodeId_configHash: { workflowId, nodeId, configHash },
      },
    });
    if (raced) {
      return {
        id: raced.id,
        anthropicAgentId: raced.anthropicAgentId,
        version: raced.version,
      };
    }
    throw err;
  }
}

async function createAnthropicAgent(params: {
  name: string;
  model: string;
  instructions: string;
  mcpServers?: AgentNodeConfig["mcpServers"];
  tools?: AgentNodeConfig["tools"];
  skills?: AgentNodeConfig["skills"];
}): Promise<{ id: string }> {
  const body: Anthropic.Beta.Agents.AgentCreateParams = {
    name: params.name,
    model: params.model as Anthropic.Beta.Agents.AgentCreateParams["model"],
    system: params.instructions,
  };
  if (params.tools && params.tools.length > 0) {
    body.tools = params.tools as Anthropic.Beta.Agents.AgentCreateParams["tools"];
  }
  if (params.mcpServers && params.mcpServers.length > 0) {
    body.mcp_servers = params.mcpServers;
  }
  if (params.skills && params.skills.length > 0) {
    body.skills = params.skills as Anthropic.Beta.Agents.AgentCreateParams["skills"];
  }
  console.log(
    `[agentRegistry] creating Anthropic agent "${params.name}" — model=${params.model}, mcp=${params.mcpServers?.length ?? 0}, tools=${params.tools?.length ?? 0}, skills=${params.skills?.length ?? 0}`
  );
  const agent = await anthropic.beta.agents.create(body);
  return { id: agent.id };
}
