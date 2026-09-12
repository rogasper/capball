import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { players } from "@/lib/db/schema";

export type Player = typeof players.$inferSelect;

export async function listPlayers(teamId: number): Promise<Player[]> {
  return db
    .select()
    .from(players)
    .where(eq(players.teamId, teamId))
    .orderBy(asc(players.shirtNumber), asc(players.name));
}

export async function createPlayer(input: {
  teamId: number;
  name: string;
  shirtNumber?: number | null;
  position?: string | null;
}): Promise<Player> {
  const name = input.name.trim();
  if (!name) throw new Error("A player needs a name.");

  const [row] = await db
    .insert(players)
    .values({
      teamId: input.teamId,
      name,
      shirtNumber: input.shirtNumber ?? null,
      position: input.position?.trim() || null,
    })
    .returning();
  return row;
}

export async function deletePlayer(id: number): Promise<void> {
  await db.delete(players).where(eq(players.id, id));
}
