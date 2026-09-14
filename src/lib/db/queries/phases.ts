import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { eventParents, events, phaseSessions, phaseTags } from "@/lib/db/schema";
import type { ParentLink, PhaseClosure } from "@/lib/phases/rules";

/** A phase session as the UI reads it: the session plus what the event is. */
export type PhaseSessionRow = {
  eventId: number;
  tagId: number;
  teamId: number | null;
  streamKey: string;
  openedAtMs: number;
  lastSeenMs: number;
  closedBy: PhaseClosure | null;
};

/**
 * Which tags open a phase (FR-55.1).
 *
 * A row's presence is the flag, so marking and unmarking is an insert and a
 * delete — no migration ever touches `tags`.
 */
export async function listPhaseTagIds(): Promise<number[]> {
  const rows = await db.select({ tagId: phaseTags.tagId }).from(phaseTags);
  return rows.map((row) => row.tagId);
}

export async function setTagPhase(tagId: number, isPhase: boolean): Promise<void> {
  if (isPhase) {
    await db.insert(phaseTags).values({ tagId }).onConflictDoNothing();
    return;
  }
  await db.delete(phaseTags).where(eq(phaseTags.tagId, tagId));
}

/**
 * Writes the session that makes a phase open (FR-55.4).
 *
 * Called in the same gesture as the event insert, so an unexpected exit cannot
 * lose the fact that the passage started.
 */
export async function openSession(input: {
  eventId: number;
  streamKey: string;
  openedAtMs: number;
}): Promise<void> {
  await db.insert(phaseSessions).values({
    eventId: input.eventId,
    streamKey: input.streamKey,
    openedAtMs: Math.round(input.openedAtMs),
    lastSeenMs: Math.round(input.openedAtMs),
    closedBy: null,
  });
}

/** Records the last playback position seen while a phase was open. */
export async function touchSession(eventId: number, lastSeenMs: number): Promise<void> {
  await db
    .update(phaseSessions)
    .set({ lastSeenMs: Math.round(lastSeenMs) })
    .where(eq(phaseSessions.eventId, eventId));
}

export async function closeSession(eventId: number, closedBy: PhaseClosure): Promise<void> {
  await db.update(phaseSessions).set({ closedBy }).where(eq(phaseSessions.eventId, eventId));
}

/**
 * Every session of a match, open and closed.
 *
 * The closure reason is part of what the timeline shows, so a phase that was
 * closed automatically is distinguishable from one the user stopped (FR-55.4).
 */
export async function listSessions(matchId: number): Promise<PhaseSessionRow[]> {
  const rows = await db
    .select({
      eventId: sql<number>`${phaseSessions.eventId}`.as("session_event_id"),
      tagId: sql<number>`${events.tagId}`.as("session_tag_id"),
      teamId: sql<number | null>`${events.teamId}`.as("session_team_id"),
      streamKey: sql<string>`${phaseSessions.streamKey}`.as("session_stream_key"),
      openedAtMs: sql<number>`${phaseSessions.openedAtMs}`.as("session_opened_at_ms"),
      lastSeenMs: sql<number>`${phaseSessions.lastSeenMs}`.as("session_last_seen_ms"),
      closedBy: sql<string | null>`${phaseSessions.closedBy}`.as("session_closed_by"),
    })
    .from(phaseSessions)
    .innerJoin(events, eq(phaseSessions.eventId, events.id))
    .where(eq(events.matchId, matchId))
    .orderBy(asc(phaseSessions.openedAtMs));

  return rows.map((row) => ({ ...row, closedBy: (row.closedBy as PhaseClosure | null) ?? null }));
}

/** Links an action to a phase. Idempotent: the same pair twice is the same fact. */
export async function linkParent(childId: number, parentId: number): Promise<void> {
  await db.insert(eventParents).values({ childId, parentId }).onConflictDoNothing();
}

/** The phase/action links of a match, for the timeline and the cycle guard. */
export async function listLinksForMatch(matchId: number): Promise<ParentLink[]> {
  const rows = await db
    .select({
      childId: sql<number>`${eventParents.childId}`.as("link_child_id"),
      parentId: sql<number>`${eventParents.parentId}`.as("link_parent_id"),
    })
    .from(eventParents)
    .innerJoin(events, eq(eventParents.childId, events.id))
    .where(eq(events.matchId, matchId));

  return rows;
}

/** How many actions a phase holds — the number FR-55.5 requires before deleting. */
export async function countActionsOfPhase(parentId: number): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)`.as("action_count") })
    .from(eventParents)
    .where(eq(eventParents.parentId, parentId));
  return Number(rows[0]?.count ?? 0);
}
