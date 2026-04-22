import type Anthropic from "@anthropic-ai/sdk";

// Tool definitions passed directly to client.messages.create({ tools: TOOLS }).
// Each entry conforms to the Anthropic SDK Tool type.

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_weather",
    description:
      "Get the current weather for a given location. Returns temperature and conditions.",
    input_schema: {
      type: "object" as const,
      properties: {
        location: {
          type: "string",
          description: "City name, e.g., 'San Francisco' or 'Paris, FR'",
        },
        unit: {
          type: "string",
          enum: ["celsius", "fahrenheit"],
          description: "Temperature unit (defaults to celsius)",
        },
      },
      required: ["location"],
    },
  },
];
