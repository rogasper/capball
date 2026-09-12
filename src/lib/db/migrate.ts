import { execute, select } from "@/lib/ipc/database";

/**
 * A small forward-only migration runner.
 *
 * Drizzle Kit emits the SQL; this applies whatever has not been applied yet and
 * records it. Each file is applied statement by statement, and only recorded
 * once every statement in it has succeeded, so a crash mid-file means the file
 * is retried rather than silently skipped.
 */

const MIGRATION_TABLE = "__capball_migrations";

// Vite inlines the generated SQL at build time, so the runner never reads the
// filesystem and cannot drift from the bundled app.
const files = import.meta.glob("./migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export function fileNameOf(path: string): string {
  return path.split("/").pop() ?? path;
}

/** Drizzle separates statements with this marker; it is never valid SQL. */
export function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

export function migrationList(): { name: string; sql: string }[] {
  return Object.entries(files)
    .map(([path, sql]) => ({ name: fileNameOf(path), sql }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function unapplied(migrations: { name: string }[], applied: Iterable<string>): string[] {
  const done = new Set(applied);
  return migrations.filter((migration) => !done.has(migration.name)).map((m) => m.name);
}

/** Applies pending migrations and returns the ones that ran. */
export async function migrate(): Promise<string[]> {
  await execute(
    `CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`,
  );

  const appliedRows = await select(`SELECT name FROM ${MIGRATION_TABLE}`);
  const applied = new Set(appliedRows.map((row) => String(row.name)));

  const ran: string[] = [];
  for (const migration of migrationList()) {
    if (applied.has(migration.name)) continue;

    for (const statement of splitStatements(migration.sql)) {
      await execute(statement);
    }
    await execute(`INSERT INTO ${MIGRATION_TABLE} (name, applied_at) VALUES (?, unixepoch())`, [
      migration.name,
    ]);
    ran.push(migration.name);
  }

  return ran;
}
