/**
 * Seed script: upserts the three demo workflows (incident commander,
 * deal desk, TPS report) into the local database.
 *
 * Usage:
 *   npm run seed:demos
 *
 * Behavior: if a workflow with the fixture's ID already exists, its
 * schema_json is overwritten (same ID → idempotent). The Agent table
 * is NOT touched — Agent rows are lazily created on first run.
 */
import fs from "fs";
import path from "path";
import prisma from "../db/client";
import { validateWorkflowSchema } from "../workflow/schemaValidator";

const FIXTURES_DIR = path.join(__dirname, "..", "workflow", "fixtures");

const DEMO_FILES = [
  "flowBuilder.json",
  "salesforceConcierge.json",
  "incidentCommander.json",
  "dealDesk.json",
  "tpsReport.json",
  "customerOnboarding.json",
  "wealthIntake.json",
  "humanGateSmoke.json",
  "logNewOpportunity.json",
];

async function upsertFromFile(filename: string): Promise<void> {
  const fullPath = path.join(FIXTURES_DIR, filename);
  const raw = fs.readFileSync(fullPath, "utf-8");
  const schema = JSON.parse(raw);

  const validation = validateWorkflowSchema(schema);
  if (!validation.valid) {
    throw new Error(
      `Fixture ${filename} failed validation:\n  - ${validation.errors.join("\n  - ")}`
    );
  }

  const id = schema.id as string;
  const name = schema.name as string;
  const schemaJson = JSON.stringify(schema);

  const existing = await prisma.workflow.findUnique({ where: { id } });
  if (existing) {
    await prisma.workflow.update({
      where: { id },
      data: { name, schemaJson, updatedAt: new Date() },
    });
    console.log(`  ✓ Updated  ${name} (${id})`);
  } else {
    await prisma.workflow.create({
      data: { id, name, schemaJson },
    });
    console.log(`  ✓ Created  ${name} (${id})`);
  }
}

async function main(): Promise<void> {
  console.log(`\n━━━ Seeding demo workflows ━━━`);
  for (const file of DEMO_FILES) {
    await upsertFromFile(file);
  }
  console.log(`\nDone. ${DEMO_FILES.length} workflow(s) seeded.\n`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
