/**
 * Node handler dispatch map.
 *
 * Maps node types to their handler functions, providing a uniform
 * interface for the executor to call any node type.
 */
import type { NodeType, NodeHandler } from "../types";
import { runInputNode } from "./inputNodeHandler";
import { runAgentNode } from "./agentNodeHandler";
import { runHumanGateNode } from "./humanGateNodeHandler";
import { runFinalizeNode } from "./finalizeNodeHandler";

const handlerMap: Record<NodeType, NodeHandler> = {
  input: runInputNode,
  agent: runAgentNode,
  human_gate: runHumanGateNode,
  finalize: runFinalizeNode,
};

/**
 * Get the handler function for a given node type.
 * Throws if the node type is unsupported.
 */
export function getNodeHandler(type: NodeType): NodeHandler {
  const handler = handlerMap[type];
  if (!handler) {
    throw new Error(`No handler registered for node type: '${type}'`);
  }
  return handler;
}
