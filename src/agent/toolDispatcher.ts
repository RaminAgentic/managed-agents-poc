import { toolHandlers } from "../data/toolHandlers";

/**
 * Dispatch a tool_use block to the matching handler.
 *
 * Happy-path only — assumes the tool name exists in the handler map.
 * Returns the handler's string result for inclusion in a tool_result message.
 */
export function dispatchTool(
  name: string,
  input: Record<string, unknown>
): string {
  const handler = toolHandlers[name];
  return handler(input);
}
