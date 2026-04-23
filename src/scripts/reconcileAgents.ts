/**
 * Reconcile Anthropic-side agents with our DB.
 *
 * Lists every non-archived agent on the Anthropic side, then checks each
 * against the `agents` table. Any agent whose id isn't referenced by a
 * row where `supersededAt IS NULL` is considered orphaned and archived.
 *
 * Usage:
 *   npm run reconcile:agents              # dry-run, checks DB for active set
 *   npm run reconcile:agents -- --apply   # actually archive
 *   npm run reconcile:agents -- --all --apply
 *                                         # archive EVERY non-archived agent
 *                                         # (use when you don't have DB access
 *                                         # and want a hard reset — the
 *                                         # registry will recreate one per node
 *                                         # on next run)
 */
import prisma from "../db/client";
import { anthropic } from "../config/anthropic";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const nuke = process.argv.includes("--all");

  console.log(
    `\n━━━ Reconciling Anthropic agents ━━━  (${apply ? "APPLY" : "DRY-RUN"}${nuke ? ", --all" : ""})\n`
  );

  const active = new Set<string>();
  if (!nuke) {
    const activeRows = await prisma.agent.findMany({
      where: { supersededAt: null },
      select: { anthropicAgentId: true, workflowId: true, nodeId: true },
    });
    for (const r of activeRows) active.add(r.anthropicAgentId);
  }
  console.log(`Active in DB: ${nuke ? "(skipped — --all mode)" : active.size}`);

  const anthropicAgents: Array<{ id: string; name?: string | null }> = [];
  for await (const a of anthropic.beta.agents.list()) {
    anthropicAgents.push({ id: a.id, name: a.name });
  }
  console.log(`On Anthropic (non-archived): ${anthropicAgents.length}\n`);

  const orphans = anthropicAgents.filter((a) => !active.has(a.id));
  console.log(`Orphans to archive: ${orphans.length}`);
  for (const a of orphans) {
    console.log(`  - ${a.id}  ${a.name ?? ""}`);
  }

  if (!apply) {
    console.log(`\nDry-run complete. Re-run with --apply to archive.\n`);
    return;
  }

  console.log(`\nArchiving...`);
  let ok = 0;
  let fail = 0;
  for (const a of orphans) {
    try {
      await anthropic.beta.agents.archive(a.id);
      ok++;
    } catch (err) {
      fail++;
      console.warn(
        `  ✗ ${a.id}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  console.log(`\nDone. archived=${ok} failed=${fail}\n`);
}

main()
  .catch((err) => {
    console.error("Reconcile failed:", err);
    process.exit(1);
  })
  .finally(() => {
    // In --all mode we never used the DB, so $disconnect may throw because
    // the client never initialized. Best-effort.
    prisma.$disconnect().catch(() => {});
  });
