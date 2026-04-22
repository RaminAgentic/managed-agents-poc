import { runOrchestrator } from "./agent/orchestrator";
import { SAMPLE_USER_PROMPTS } from "./data/prompts";

async function main(): Promise<void> {
  const argPrompt = process.argv.slice(2).join(" ").trim();
  const prompt = argPrompt || SAMPLE_USER_PROMPTS[0];

  const response = await runOrchestrator(prompt);
  console.log(response);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
