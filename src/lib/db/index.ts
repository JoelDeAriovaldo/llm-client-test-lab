import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

export function openDb(file: string): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  // WAL lets the web app read while the worker writes.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

export function migrateDb(db: Db) {
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
}

const globalForDb = globalThis as unknown as { labDb?: Db };

/** The app's shared connection. Kept on globalThis so dev reloads don't reopen it. */
export function getDb(): Db {
  globalForDb.labDb ??= openDb(process.env.LAB_DB_PATH ?? path.join(process.cwd(), "data", "lab.db"));
  return globalForDb.labDb;
}

export { schema };
