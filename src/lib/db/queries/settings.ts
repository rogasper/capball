import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";

/** Key/value preferences, one row per setting. */

export async function readSettings(): Promise<Record<string, string>> {
  const rows = await db.select().from(settings);
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export async function writeSettings(values: Record<string, string>): Promise<void> {
  const entries = Object.entries(values);
  if (entries.length === 0) return;

  for (const [key, value] of entries) {
    await db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value: sql`excluded.value` } });
  }
}
