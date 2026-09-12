import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { events, players, tagCategories, tags, teams } from "@/lib/db/schema";

/** An event as the UI shows it: ids plus the names behind them. */
export type EventRow = {
  id: number;
  /** Which video of the match this event belongs to (a match may hold several). */
  videoId: number;
  /** The moment the user tagged; the clip range hangs around it. */
  anchorMs: number;
  startMs: number;
  endMs: number;
  notes: string | null;
  tagId: number;
  tagName: string;
  tagColor: string | null;
  categoryName: string;
  teamId: number | null;
  teamName: string | null;
  playerId: number | null;
  playerName: string | null;
};

export type NewEvent = {
  matchId: number;
  videoId: number;
  tagId: number;
  teamId?: number | null;
  playerId?: number | null;
  anchorMs: number;
  startMs: number;
  endMs: number;
  notes?: string | null;
};

/**
 * Every projected column carries an explicit alias.
 *
 * The SQL plugin returns rows as objects keyed by result column name, and the
 * proxy hands Drizzle positional values. Four of these columns are literally
 * called `name`, so without aliases the driver would collapse them into one key
 * and every value after the first would shift. See AGENTS.md.
 */
export async function listEvents(matchId: number): Promise<EventRow[]> {
  return db
    .select({
      id: sql<number>`${events.id}`.as("event_id"),
      videoId: sql<number>`${events.videoId}`.as("video_id"),
      anchorMs: sql<number>`${events.anchorMs}`.as("anchor_ms"),
      startMs: sql<number>`${events.startMs}`.as("start_ms"),
      endMs: sql<number>`${events.endMs}`.as("end_ms"),
      notes: sql<string | null>`${events.notes}`.as("notes"),
      tagId: sql<number>`${events.tagId}`.as("tag_id"),
      tagName: sql<string>`${tags.name}`.as("tag_name"),
      tagColor: sql<string | null>`${tags.color}`.as("tag_color"),
      categoryName: sql<string>`${tagCategories.name}`.as("category_name"),
      teamId: sql<number | null>`${events.teamId}`.as("team_id"),
      teamName: sql<string | null>`${teams.name}`.as("team_name"),
      playerId: sql<number | null>`${events.playerId}`.as("player_id"),
      playerName: sql<string | null>`${players.name}`.as("player_name"),
    })
    .from(events)
    .innerJoin(tags, eq(events.tagId, tags.id))
    .innerJoin(tagCategories, eq(tags.categoryId, tagCategories.id))
    .leftJoin(teams, eq(events.teamId, teams.id))
    .leftJoin(players, eq(events.playerId, players.id))
    .where(eq(events.matchId, matchId))
    .orderBy(asc(events.startMs), asc(events.id));
}

/**
 * Writes one event. Capture calls this directly and awaits it, so an event that
 * was confirmed on screen is already on disk (FR-5.4).
 */
export async function createEvent(input: NewEvent): Promise<number> {
  const [row] = await db
    .insert(events)
    .values({
      matchId: input.matchId,
      videoId: input.videoId,
      tagId: input.tagId,
      teamId: input.teamId ?? null,
      playerId: input.playerId ?? null,
      anchorMs: Math.round(input.anchorMs),
      startMs: Math.round(input.startMs),
      endMs: Math.round(input.endMs),
      notes: input.notes ?? null,
    })
    .returning({ id: events.id });
  return row.id;
}

export async function updateEventRange(id: number, startMs: number, endMs: number): Promise<void> {
  await db
    .update(events)
    .set({
      startMs: Math.round(startMs),
      endMs: Math.round(endMs),
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(events.id, id));
}

export async function updateEventNotes(id: number, notes: string | null): Promise<void> {
  await db
    .update(events)
    .set({ notes, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(events.id, id));
}

export async function deleteEvent(id: number): Promise<void> {
  await db.delete(events).where(eq(events.id, id));
}

export async function getEvent(id: number): Promise<typeof events.$inferSelect | undefined> {
  const rows = await db.select().from(events).where(eq(events.id, id)).limit(1);
  return rows[0];
}
