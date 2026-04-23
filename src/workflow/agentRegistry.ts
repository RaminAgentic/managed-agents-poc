/**
 * Agent Registry — one Anthropic agent per (workflow, node), with
 * our DB holding the config history for audit and revival.
 *
 * Design:
 * - Anthropic side: ONE agent per (workflowId, nodeId). Its system/tools/
 *   model are updated in place via `beta.agents.update` as the config
 *   evolves. Anthropic natively versions these updates.
 * - Our side: one `Agent` row per distinct config ever seen for that node.
 *   All rows for the same (workflowId, nodeId) share the same
 *   `anthropicAgentId`. `supersededAt IS NULL` flags the config that's
 *   currently applied on Anthropic.
 *
 * Consequences:
 * - The Anthropic console shows one agent per node — not a per-run pile.
 * - Reviving a past config = re-apply that row's `configJson` via
 *   `beta.agents.update` (the id doesn't change).
 * - Old runs still reference their original Agent row in `RunStep`, so
 *   the exact config used at run-time is recoverable even though the
 *   live Anthropic agent has moved on.
 *
 * The identity hash covers only fields that change what the Anthropic
 * agent DOES (instructions, model, mcp_servers, tools, skills). Execution-
 * time fields (inputMapping, timeoutSeconds, outputFormat) don't produce
 * new versions.
 */
import crypto from "crypto";
import type Anthropic from "@anthropic-ai/sdk";
import prisma from "../db/client";
import { anthropic } from "../config/anthropic";
import type { AgentNodeConfig, ModelConfig, AgentTool } from "./types";
import { SF_TOOL_DEFINITIONS } from "../tools/salesforce";
import { FLOW_BUILDER_TOOL_DEFINITIONS } from "../tools/flowBuilder";

function expandTools(config: AgentNodeConfig): AgentTool[] | undefined {
  const base = (config.tools ?? []).slice();
  if (config.includeSalesforceTools) {
    for (const t of SF_TOOL_DEFINITIONS) {
      base.push(t as unknown as AgentTool);
    }
  }
  if (config.includeFlowBuilderTools) {
    for (const t of FLOW_BUILDER_TOOL_DEFINITIONS) {
      base.push(t as unknown as AgentTool);
    }
  }
  return base.length > 0 ? base : undefined;
}

const DEFAULT_MODEL = "claude-opus-4-7";

interface AgentIdentity {
  instructions: string;
  model?: string;
  speed?: "standard" | "fast";
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
  if (modelConfig?.speed) identity.speed = modelConfig.speed;
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
 * Resolve the Agent row for a workflow node. Creates the Anthropic agent
 * on first touch; for subsequent configs, updates the same agent in place.
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
  const agentName = `${nodeName} (${nodeId})`.slice(0, 100);

  const existing = await prisma.agent.findUnique({
    where: {
      workflowId_nodeId_configHash: { workflowId, nodeId, configHash },
    },
  });

  if (existing) {
    if (!existing.supersededAt) {
      return toResolved(existing);
    }
    // Reviving a past config — re-apply it to the shared Anthropic agent
    // and flip supersededAt on our side.
    await applyIdentity(existing.anthropicAgentId, agentName, identity);
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
    return toResolved(existing);
  }

  // New config. Pick (or create) the canonical Anthropic agent for this
  // node and update it in place.
  const nodeRows = await prisma.agent.findMany({
    where: { workflowId, nodeId },
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      anthropicAgentId: true,
      supersededAt: true,
    },
  });

  let anthropicAgentId: string;
  if (nodeRows.length === 0) {
    // First-ever row for this node — create the Anthropic agent.
    const created = await createAnthropicAgent(agentName, identity);
    anthropicAgentId = created.id;
  } else {
    // Reuse the active row's id (or the latest, if nothing active).
    const active = nodeRows.find((r) => r.supersededAt === null);
    anthropicAgentId = (active ?? nodeRows[0]).anthropicAgentId;
    await applyIdentity(anthropicAgentId, agentName, identity);
  }

  const nextVersion = (nodeRows[0]?.version ?? 0) + 1;

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
          anthropicAgentId,
        },
      }),
    ]);
    return toResolved(inserted);
  } catch (err: unknown) {
    // Race: another caller inserted the same configHash first. Refetch.
    const raced = await prisma.agent.findUnique({
      where: {
        workflowId_nodeId_configHash: { workflowId, nodeId, configHash },
      },
    });
    if (raced) {
      return toResolved(raced);
    }
    throw err;
  }
}

function toResolved(row: {
  id: string;
  anthropicAgentId: string;
  version: number;
}): ResolvedAgent {
  return {
    id: row.id,
    anthropicAgentId: row.anthropicAgentId,
    version: row.version,
  };
}

function buildModelField(
  model: string,
  speed?: "standard" | "fast"
): Anthropic.Beta.Agents.AgentCreateParams["model"] {
  return speed
    ? ({ id: model, speed } as unknown as Anthropic.Beta.Agents.AgentCreateParams["model"])
    : (model as Anthropic.Beta.Agents.AgentCreateParams["model"]);
}

async function createAnthropicAgent(
  name: string,
  identity: AgentIdentity
): Promise<{ id: string }> {
  const body: Anthropic.Beta.Agents.AgentCreateParams = {
    name,
    model: buildModelField(identity.model ?? DEFAULT_MODEL, identity.speed),
    system: identity.instructions,
  };
  if (identity.tools && identity.tools.length > 0) {
    body.tools = identity.tools as Anthropic.Beta.Agents.AgentCreateParams["tools"];
  }
  if (identity.mcpServers && identity.mcpServers.length > 0) {
    body.mcp_servers = identity.mcpServers;
  }
  if (identity.skills && identity.skills.length > 0) {
    body.skills = identity.skills as Anthropic.Beta.Agents.AgentCreateParams["skills"];
  }
  console.log(
    `[agentRegistry] creating Anthropic agent "${name}" — model=${identity.model ?? DEFAULT_MODEL}, mcp=${identity.mcpServers?.length ?? 0}, tools=${identity.tools?.length ?? 0}, skills=${identity.skills?.length ?? 0}`
  );
  const agent = await anthropic.beta.agents.create(body);
  return { id: agent.id };
}

/**
 * Push an identity onto an existing Anthropic agent via update. Retrieves
 * the current version for optimistic-locking, retries once on version
 * mismatch (another update landed between retrieve and update).
 */
async function applyIdentity(
  agentId: string,
  name: string,
  identity: AgentIdentity
): Promise<void> {
  const doUpdate = async (): Promise<void> => {
    const current = await anthropic.beta.agents.retrieve(agentId);
    const body: Anthropic.Beta.Agents.AgentUpdateParams = {
      version: current.version,
      name,
      model: buildModelField(
        identity.model ?? DEFAULT_MODEL,
        identity.speed
      ) as Anthropic.Beta.Agents.AgentUpdateParams["model"],
      system: identity.instructions,
      tools: (identity.tools ?? []) as Anthropic.Beta.Agents.AgentUpdateParams["tools"],
      mcp_servers: (identity.mcpServers ?? []) as Anthropic.Beta.Agents.AgentUpdateParams["mcp_servers"],
      skills: (identity.skills ?? []) as Anthropic.Beta.Agents.AgentUpdateParams["skills"],
    };
    await anthropic.beta.agents.update(agentId, body);
  };

  try {
    await doUpdate();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/version/i.test(msg)) {
      await doUpdate();
      return;
    }
    throw err;
  }
  console.log(`[agentRegistry] updated Anthropic agent ${agentId} ("${name}")`);
}
