/**
 * SQLite database client using better-sqlite3.
 *
 * Single source of truth for the DB connection. All persistence code
 * imports `db` from here — never create additional connections.
 */
import Database from "better-sqlite3";
import path from "path";

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "data", "workflow.db");

// Ensure the data directory exists
import fs from "fs";
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export default db;
