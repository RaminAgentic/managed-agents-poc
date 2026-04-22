/**
 * Database schema initialization — NO-OP shim.
 *
 * Prisma now owns the schema via prisma/schema.prisma.
 * Migrations are applied with `npx prisma migrate dev`.
 *
 * This file is kept as a no-op so existing `import { initializeSchema }` calls
 * don't break during the transition.
 */
export function initializeSchema(): void {
  // No-op: Prisma handles schema creation via migrations.
  console.log("[db] Schema managed by Prisma — skipping manual init.");
}
