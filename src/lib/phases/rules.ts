/**
 * Phase rules (R2, FR-55) — pure, so the rules can be tested without a database,
 * a video or a React tree.
 *
 * A phase is a tag that is **started and stopped**: the event it produces has a
 * real duration instead of pre-roll and post-roll. What this module decides is
 * everything that must be true before a row is written:
 *
 * - which **stream** a phase belongs to, and therefore what it closes (`D39`);
 * - what an action pressed inside a phase belongs to, and when the app must
 *   refuse to guess (`FR-55.3`);
 * - whether a link would make a phase its own ancestor (`D38`);
 * - what window an event's clip actually covers (`D41`) — which is where the
 *   padding of `PRD.md` FR-5.2 stops being stored and becomes derived.
 */

import { clampRangeToVideo, clipRange } from "@/lib/time/timecode";

/** One open phase, as the store holds it. */
export type OpenPhase = {
  eventId: number;
  tagId: number;
  /** `team:<id>`, or `team:none` when no team is active. */
  streamKey: string;
  /** The team the phase belongs to; `null` is the no-team stream. */
  teamId: number | null;
  startedAtMs: number;
};

/** Why a phase stopped. `null` means it is still running. */
export type PhaseClosure = "user" | "new-phase" | "video-end" | "exit" | "empty";

/** What made a phase stop. `exit` is the only one whose reason has two forms. */
export type PhaseTrigger = Exclude<PhaseClosure, "empty">;

export const NO_TEAM_STREAM = "team:none";

/**
 * The stream a phase runs in: the team it belongs to.
 *
 * One phase per stream may be open, so two teams' phases can run together while
 * a second phase of the same team replaces the first (FR-55.2).
 */
export function streamKeyOf(teamId: number | null): string {
  return teamId === null ? NO_TEAM_STREAM : `team:${teamId}`;
}

/** The team a stream belongs to, or `null` for the no-team stream. */
export function teamIdOfStream(streamKey: string): number | null {
  if (streamKey === NO_TEAM_STREAM) return null;
  const value = Number(streamKey.replace("team:", ""));
  return Number.isFinite(value) ? value : null;
}

/**
 * The reason recorded for a closure.
 *
 * `exit` is the interesting one: an app that was killed recorded a last-seen
 * position or it did not, and a phase that never got a second write is `empty`
 * rather than a long span nobody observed (FR-55.4).
 */
export function closureReason(trigger: PhaseTrigger, sawPlayback: boolean): PhaseClosure {
  if (trigger !== "exit") return trigger;
  return sawPlayback ? "exit" : "empty";
} /** Where an open phase's end is written when the app closed under it. */
export function interruptedEndMs(openedAtMs: number, lastSeenMs: number | null): number {
  return Math.max(openedAtMs, lastSeenMs ?? openedAtMs);
}

export type ParentResolution =
  | { kind: "attach"; parentId: number }
  | { kind: "none"; reason: "no-open-phase" | "ambiguous" };

/**
 * What a moment pressed now belongs to (FR-55.3).
 *
 * 1. the open phase of the moment's own team, if there is one;
 * 2. otherwise the **only** open phase — the possession case, where the
 *    defending side's press belongs inside the attacking side's phase;
 * 3. otherwise nothing, and the caller says so. Guessing a parent would put the
 *    action in a phase the user did not choose, which is worse than no link.
 */
export function parentForMoment(momentTeamId: number | null, open: OpenPhase[]): ParentResolution {
  if (open.length === 0) return { kind: "none", reason: "no-open-phase" };

  const own = open.find((phase) => phase.teamId === momentTeamId);
  if (own) return { kind: "attach", parentId: own.eventId };

  if (open.length === 1) {
    const only = open[0];
    return only
      ? { kind: "attach", parentId: only.eventId }
      : { kind: "none", reason: "ambiguous" };
  }

  return { kind: "none", reason: "ambiguous" };
}

/**
 * How a phase ended, in words (FR-55.4).
 *
 * "Closed by me" and "closed automatically" are different facts about the
 * record, and the timeline and the event list must say the same thing about the
 * same row — so the wording lives here, beside the reasons it describes.
 */
export function describeClosure(closure: PhaseClosure | null | undefined): string {
  // The three states are genuinely different, and conflating the last two is what
  // made a padded moment look like a phase that never stopped: `null` is an open
  // session, `undefined` is an event whose tag was not a phase when it was made.
  if (closure === undefined) return "not a phase run";
  if (closure === null) return "recording";

  switch (closure) {
    case "user":
      return "stopped by you";
    case "new-phase":
      return "closed when the next phase of this team started";
    case "video-end":
      return "closed automatically at the end of the video";
    case "exit":
      return "closed automatically at the last recorded position, after the app exited";
    case "empty":
      return "closed empty: no position was recorded while it ran";
  }
}

/** One `event_parents` row, as a plain pair. */
export type ParentLink = { childId: number; parentId: number };

/**
 * Would this link make `childId` its own ancestor?
 *
 * A cycle would make a duration count itself and a recursive query never
 * terminate, so the write is refused with a reason rather than stored (D38).
 */
export function wouldCycle(links: ParentLink[], childId: number, parentId: number): boolean {
  if (childId === parentId) return true;

  const parentsOf = new Map<number, number[]>();
  for (const link of links) {
    const list = parentsOf.get(link.childId);
    if (list) list.push(link.parentId);
    else parentsOf.set(link.childId, [link.parentId]);
  }

  // Walk up from the proposed parent: if the child is reachable, it is an ancestor.
  const seen = new Set<number>();
  const queue = [parentId];
  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    for (const ancestor of parentsOf.get(current) ?? []) {
      if (ancestor === childId) return true;
      queue.push(ancestor);
    }
  }

  return false;
}

/** What an event's window is, and why (D41). */
export type ResolvedWindow = { startMs: number; endMs: number; source: "stored" | "padding" };

/**
 * The clip window an event resolves to.
 *
 * A **phase** is its own span and is never padded: padding a passage would
 * invent the time the phase model exists to record. Anything else with an
 * explicit range keeps it — that is R0's moment, whose stored range is already
 * the padding captured when it was tagged, and a range the user trimmed by hand.
 * Only an event that is a bare instant (an action inside a phase, which stores
 * the instant rather than a range) falls back to the pre-roll and post-roll,
 * resolved at the moment a clip is made rather than stored on the row.
 *
 * The result is clamped to the video, so a window can never leave its footage.
 */
export function resolveWindow(
  event: { startMs: number; endMs: number; anchorMs: number; kind: "phase" | "event" },
  roll: { preRollMs: number; postRollMs: number },
  durationMs: number,
): ResolvedWindow {
  if (event.kind === "phase") {
    return { ...clampRangeToVideo(event.startMs, event.endMs, durationMs), source: "stored" };
  }

  if (event.endMs > event.startMs) {
    return { ...clampRangeToVideo(event.startMs, event.endMs, durationMs), source: "stored" };
  }

  const span = clipRange(event.anchorMs, roll.preRollMs, roll.postRollMs, durationMs);
  return { ...span, source: "padding" };
}

/**
 * The phases an action belongs to, for display.
 *
 * Kept as a function rather than a field so a child with two parents (OQ-R2-16)
 * cannot be shown as if it had one.
 */
export function parentsOfChild(links: ParentLink[], childId: number): number[] {
  return links.filter((link) => link.childId === childId).map((link) => link.parentId);
}
