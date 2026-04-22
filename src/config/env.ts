// Single source of truth for environment variable loading.
// No other file should call dotenv.config() — import this module instead.
import "dotenv/config";

const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

if (!anthropicApiKey) {
  throw new Error(
    "Missing ANTHROPIC_API_KEY. Copy .env.example → .env and set your key.\n" +
      "Get a key at https://console.anthropic.com/settings/keys"
  );
}

export const env = {
  anthropicApiKey,
} as const;
