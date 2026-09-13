import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { events, players, positions, teams } from "@/lib/db/schema";

/**
 * Player positions (R1, FR-30.3).
 *
 * The pitch coordinates stored here are the user's assertion. Nothing re-derives
 * them on read: adjusting a calibration must not silently move a position that
 * was placed against an earlier one (FR-30.2). The click travels alongside as
 * provenance.
 */

export type PositionRow = {
  id: number;
  /** Client-generated identity, carried so transfer can be idempotent (D21). */
  uid: string;
  eventId: number;
  playerId: number;
  playerName: string;
  shirtNumber: number | null;
  teamId: number;
  teamName: string;
  teamColor: string | null;
  /** Null when the calibration it came from has been deleted. */
  calibrationId: number | null;
  imageU: number;
  imageV: number;
  xM: number;
  yM: number;
};

export type NewPosition = {
  uid: string;
  eventId: number;
  playerId: number;
  teamId: number;
  calibrationId: number | null;
  imageU: number;
  imageV: number;
  xM: number;
  yM: number;
};

/**
 * Every projected column carries an explicit alias.
 *
 * `players.name` and `teams.name` are both called `name`, and the SQL plugin keys
 * rows by result column name while the Drizzle proxy reads them positionally — so
 * without the aliases the second one collapses into the first and every value
 * after it shifts. See AGENTS.md rule 8.
 */
export async function listPositions(eventId: number): Promise<PositionRow[]> {
  return db
    .select({
      id: sql<number>`${positions.id}`.as("position_id"),
      uid: sql<string>`${positions.uid}`.as("position_uid"),
      eventId: sql<number>`${positions.eventId}`.as("position_event_id"),
      playerId: sql<number>`${positions.playerId}`.as("position_player_id"),
      playerName: sql<string>`${players.name}`.as("position_player_name"),
      shirtNumber: sql<number | null>`${players.shirtNumber}`.as("position_shirt_number"),
      teamId: sql<number>`${positions.teamId}`.as("position_team_id"),
      teamName: sql<string>`${teams.name}`.as("position_team_name"),
      teamColor: sql<string | null>`${teams.color}`.as("position_team_color"),
      calibrationId: sql<number | null>`${positions.calibrationId}`.as("position_calibration_id"),
      imageU: sql<number>`${positions.imageU}`.as("position_image_u"),
      imageV: sql<number>`${positions.imageV}`.as("position_image_v"),
      xM: sql<number>`${positions.xM}`.as("position_x_m"),
      yM: sql<number>`${positions.yM}`.as("position_y_m"),
    })
    .from(positions)
    .innerJoin(players, eq(positions.playerId, players.id))
    .innerJoin(teams, eq(positions.teamId, teams.id))
    .where(eq(positions.eventId, eventId))
    .orderBy(asc(positions.teamId), asc(players.shirtNumber), asc(positions.id));
}

/**
 * Writes one position, replacing whatever the same player already had here.
 *
 * Marking a player twice in one event is a correction, not a second position: a
 * player has one place at one moment. The unique index says the same thing, so
 * this updates rather than relying on the constraint to reject.
 */
export async function savePosition(input: NewPosition): Promise<number> {
  const rows = await db
    .select({ id: positions.id, playerId: positions.playerId })
    .from(positions)
    .where(eq(positions.eventId, input.eventId));

  const match = rows.find((row) => row.playerId === input.playerId);

  if (match) {
    await db
      .update(positions)
      .set({
        imageU: input.imageU,
        imageV: input.imageV,
        xM: input.xM,
        yM: input.yM,
        calibrationId: input.calibrationId,
      })
      .where(eq(positions.id, match.id));
    return match.id;
  }

  const [row] = await db
    .insert(positions)
    .values({
      uid: input.uid,
      eventId: input.eventId,
      playerId: input.playerId,
      teamId: input.teamId,
      calibrationId: input.calibrationId,
      imageU: input.imageU,
      imageV: input.imageV,
      xM: input.xM,
      yM: input.yM,
    })
    .returning({ id: positions.id });
  return row.id;
}

export async function deletePosition(id: number): Promise<void> {
  await db.delete(positions).where(eq(positions.id, id));
}

/** How many positions an event would take with it (FR-30.6). */
export async function countPositions(eventId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)`.as("position_count") })
    .from(positions)
    .where(eq(positions.eventId, eventId));
  return Number(row?.count ?? 0);
}

/** The events of a match that have positions, for the comparison view (FR-30.7). */
export async function eventsWithPositions(matchId: number): Promise<number[]> {
  const rows = await db
    .select({ eventId: sql<number>`${positions.eventId}`.as("position_event_id") })
    .from(positions)
    .innerJoin(events, eq(positions.eventId, events.id))
    .where(eq(events.matchId, matchId))
    .groupBy(positions.eventId);
  return rows.map((row) => row.eventId);
}
