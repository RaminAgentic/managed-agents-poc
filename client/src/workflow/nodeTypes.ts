import type { NodeTypes } from "@xyflow/react";
import InputNode from "./nodes/InputNode";
import AgentNode from "./nodes/AgentNode";
import GateNode from "./nodes/GateNode";
import RouterNode from "./nodes/RouterNode";
import HumanGateNode from "./nodes/HumanGateNode";
import FinalizeNode from "./nodes/FinalizeNode";

export const nodeTypes: NodeTypes = {
  input: InputNode,
  agent: AgentNode,
  gate: GateNode,
  router: RouterNode,
  human_gate: HumanGateNode,
  finalize: FinalizeNode,
};
