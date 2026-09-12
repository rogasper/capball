import Database from "@tauri-apps/plugin-sql";

/**
 * The database bridge. Lives under `src/lib/ipc/` because it is one of the few
 * places allowed to import `@tauri-apps/*` (see AGENTS.md).
 *
 * The plugin speaks SQL strings; Drizzle builds them. Nothing else in the app
 * should call these directly — go through `src/lib/db`.
 */

export type SqlValue = string | number | null;
export type Row = Record<string, unknown>;

let handle: Promise<Database> | null = null;

function database(): Promise<Database> {
  // One SQLite file per library, inside the app config directory.
  if (!handle) handle = Database.load("sqlite:capball.db");
  return handle;
}

export async function execute(sql: string, params: SqlValue[] = []): Promise<void> {
  const db = await database();
  await db.execute(sql, params);
}

export async function select(sql: string, params: SqlValue[] = []): Promise<Row[]> {
  const db = await database();
  return db.select<Row[]>(sql, params);
}
