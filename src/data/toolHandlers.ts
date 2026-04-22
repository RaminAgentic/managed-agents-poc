// Stub tool handlers — return deterministic mock data.
// Each handler receives the parsed tool input and returns a JSON string
// suitable for the Messages API tool_result content block.

export type ToolHandler = (input: Record<string, unknown>) => string;

export const toolHandlers: Record<string, ToolHandler> = {
  get_weather: (input) => {
    const location = String(input.location ?? "unknown");
    const unit = input.unit === "fahrenheit" ? "F" : "C";
    const temp = unit === "F" ? 68 : 20;
    return JSON.stringify({
      location,
      temperature: temp,
      unit,
      conditions: "partly cloudy",
    });
  },
};
