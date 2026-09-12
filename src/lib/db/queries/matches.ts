import { desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { db } from "@/lib/db/client";
import { matches, teams, videos } from "@/lib/db/schema";

const homeTeam = alias(teams, "home_team");
const awayTeam = alias(teams, "away_team");

export type Match = typeof matches.$inferSelect;

export type MatchSummary = {
  id: number;
  homeTeam: string;
  awayTeam: string;
  competition: string | null;
  kickoffAt: number | null;
  videoCount: number;
};

/**
 * Aliases are mandatory here for the same reason as in `listEvents`: both team
 * names come from the `teams` table, so an unaliased select would collapse them
 * into a single result column.
 */
export async function listMatches(): Promise<MatchSummary[]> {
  return db
    .select({
      id: sql<number>`${matches.id}`.as("match_id"),
      homeTeam: sql<string>`${homeTeam.name}`.as("home_team_name"),
      awayTeam: sql<string>`${awayTeam.name}`.as("away_team_name"),
      competition: sql<string | null>`${matches.competition}`.as("competition"),
      kickoffAt: sql<number | null>`${matches.kickoffAt}`.as("kickoff_at"),
      videoCount: sql<number>`count(${videos.id})`.as("video_count"),
    })
    .from(matches)
    .innerJoin(homeTeam, eq(matches.homeTeamId, homeTeam.id))
    .innerJoin(awayTeam, eq(matches.awayTeamId, awayTeam.id))
    .leftJoin(videos, eq(videos.matchId, matches.id))
    .groupBy(matches.id)
    .orderBy(desc(matches.kickoffAt), desc(matches.id));
}

export async function getMatch(id: number): Promise<Match | undefined> {
  const rows = await db.select().from(matches).where(eq(matches.id, id)).limit(1);
  return rows[0];
}

export async function createMatch(input: {
  homeTeamId: number;
  awayTeamId: number;
  competition?: string | null;
  season?: string | null;
  kickoffAt?: number | null;
  venue?: string | null;
}): Promise<number> {
  if (input.homeTeamId === input.awayTeamId) {
    throw new Error("A match needs two different teams.");
  }

  const [row] = await db
    .insert(matches)
    .values({
      homeTeamId: input.homeTeamId,
      awayTeamId: input.awayTeamId,
      competition: input.competition?.trim() || null,
      season: input.season?.trim() || null,
      kickoffAt: input.kickoffAt ?? null,
      venue: input.venue?.trim() || null,
    })
    .returning({ id: matches.id });
  return row.id;
}

/** Deletes the match and everything hanging off it, by foreign key cascade. */
export async function deleteMatch(id: number): Promise<void> {
  await db.delete(matches).where(eq(matches.id, id));
}
