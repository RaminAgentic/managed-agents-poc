/**
 * Prisma database client — single source of truth for DB access.
 *
 * All persistence code imports `prisma` from here.
 * The old better-sqlite3 synchronous client has been replaced
 * with PrismaClient (async) as of Sprint 6.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export default prisma;
