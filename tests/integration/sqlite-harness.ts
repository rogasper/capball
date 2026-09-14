import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as schema from "@/lib/db/schema";

/**
 * A real SQLite database standing in for the Tauri plugin.
 *
 * Integration tests point both the Drizzle client and the raw IPC bridge at
 * this, so shipped SQL — including the hand-written recursive CTE and the
 * five-table join in `listEvents` — is executed rather than merely generated.
 */
export const sqlite = new DatabaseSync(":memory:");
sqlite.exec("PRAGMA foreign_keys = ON");

const migrationsDir = join(process.cwd(), "src/lib/db/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()) {
  const body = readFileSync(join(migrationsDir, file), "utf8");
  for (const statement of body.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) sqlite.exec(trimmed);
  }
}

const TABLES = [
  "events",
  "clips",
  "annotations",
  "annotation_windows",
  "calibration_points",
  "calibrations",
  "positions",
  "event_parents",
  "phase_sessions",
  "phase_tags",
  "videos",
  "matches",
  "players",
  "teams",
  "tags",
  "tag_categories",
];

/** Empties the library between tests; children before parents. */
export function resetDatabase(): void {
  for (const table of TABLES) sqlite.exec(`DELETE FROM ${table}`);
}

type Value = string | number | null;

export async function execute(sql: string, params: Value[] = []): Promise<void> {
  sqlite.prepare(sql).run(...params);
}

export async function select(
  sql: string,
  params: Value[] = [],
): Promise<Record<string, unknown>[]> {
  return sqlite.prepare(sql).all(...params) as Record<string, unknown>[];
}

export const db = drizzle(
  async (sql, params, method) => {
    const values = (params ?? []) as Value[];
    if (method === "run") {
      sqlite.prepare(sql).run(...values);
      return { rows: [] };
    }
    const rows = sqlite.prepare(sql).all(...values) as Record<string, unknown>[];
    // Mirrors src/lib/db/client.ts: positional values in SELECT order.
    return { rows: rows.map((row) => Object.values(row)) };
  },
  { schema },
);
