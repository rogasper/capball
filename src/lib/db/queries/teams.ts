import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { teams } from "@/lib/db/schema";

export type Team = typeof teams.$inferSelect;

export async function listTeams(): Promise<Team[]> {
  return db.select().from(teams).orderBy(asc(teams.name));
}

export async function findTeamByName(name: string): Promise<Team | undefined> {
  const rows = await db.select().from(teams).where(eq(teams.name, name.trim())).limit(1);
  return rows[0];
}

/** Creates a team, or returns the existing one with that name (FR-8.3). */
export async function ensureTeam(input: {
  name: string;
  shortName?: string | null;
}): Promise<Team> {
  const name = input.name.trim();
  if (!name) throw new Error("A team needs a name.");

  const existing = await findTeamByName(name);
  if (existing) return existing;

  const [row] = await db
    .insert(teams)
    .values({ name, shortName: input.shortName?.trim() || null })
    .returning();
  return row;
}

export async function renameTeam(id: number, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A team needs a name.");
  await db.update(teams).set({ name: trimmed }).where(eq(teams.id, id));
}

/**
 * Sets a team's colour, or clears it with `null` (FR-8.1).
 *
 * The column has existed since R0 and every marker reads it — the pitch view,
 * the overlay on the frame and the marking panel — but nothing could write it
 * until R2, so every marker fell back to a neutral and two teams looked alike.
 */
export async function setTeamColor(id: number, color: string | null): Promise<void> {
  await db.update(teams).set({ color }).where(eq(teams.id, id));
}
