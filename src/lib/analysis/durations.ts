/**
 * Duration, as a measure of its own (R2, FR-50.5) — pure, rows in, totals out.
 *
 * R2's statistics count events by their **anchor**, so a count answers "how
 * often". This module answers "how long", which only a phase can: a moment's
 * range is pre-roll and post-roll, and adding that padding up would measure the
 * app's arithmetic rather than the football.
 *
 * The two measures stay apart on purpose. A caller that shows a duration must
 * show what it is a duration **of**, and a count of actions is a different
 * number — an action inside two phases is counted once per phase, which
 * `countActionsPerPhase` states rather than hides.
 */

/** One phase's span, as it is read from the events table. */
export type PhaseSpan = {
  tagId: number;
  teamId: number | null;
  startMs: number;
  endMs: number;
};

/** A duration total that names what it counted. */
export type DurationTotal = {
  tagId: number;
  teamId: number | null;
  durationMs: number;
  /** How many phase spans produced it, so one long phase cannot look like many. */
  phaseCount: number;
};

/** A span clipped to its video, and to nothing else. */
function clippedMs(span: PhaseSpan, videoDurationMs: number): number {
  const startMs = Math.max(0, span.startMs);
  const endMs = Math.min(videoDurationMs > 0 ? videoDurationMs : span.endMs, span.endMs);
  return Math.max(0, endMs - startMs);
}

/**
 * Total time in phase, across spans.
 *
 * Every span is clamped to `[0, videoDurationMs]` before it is summed: a phase
 * that was trimmed past the end of its footage contributes the footage it has,
 * not the time it claims.
 */
export function totalDurationMs(spans: PhaseSpan[], videoDurationMs: number): number {
  return spans.reduce((total, span) => total + clippedMs(span, videoDurationMs), 0);
}

/**
 * Duration per tag, and per team when a team is part of the grouping.
 *
 * Returned sorted by duration so the order is stable and meaningful — the same
 * input always produces the same order, which is what makes the figure
 * reportable (NFR-33).
 */
export function durationsByTag(
  spans: PhaseSpan[],
  videoDurationMs: number,
  options: { byTeam?: boolean } = {},
): DurationTotal[] {
  const totals = new Map<string, DurationTotal>();

  for (const span of spans) {
    const durationMs = clippedMs(span, videoDurationMs);
    const teamId = options.byTeam ? span.teamId : null;
    const key = `${span.tagId}:${teamId ?? "none"}`;
    const existing = totals.get(key);

    if (existing) {
      existing.durationMs += durationMs;
      existing.phaseCount += 1;
    } else {
      totals.set(key, { tagId: span.tagId, teamId, durationMs, phaseCount: 1 });
    }
  }

  return [...totals.values()].sort(
    (a, b) =>
      b.durationMs - a.durationMs || a.tagId - b.tagId || (a.teamId ?? -1) - (b.teamId ?? -1),
  );
}

/**
 * How many actions each phase holds.
 *
 * An action with two parents (OQ-R2-16) is counted for **both**, which is what
 * the link says; `actionsWithSeveralPhases` is how a view reports that its
 * counts sum to more than the number of events.
 */
export function countActionsPerPhase(
  links: { childId: number; parentId: number }[],
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const link of links) {
    counts.set(link.parentId, (counts.get(link.parentId) ?? 0) + 1);
  }
  return counts;
}

/** The actions that belong to more than one phase, so a view can say how many. */
export function actionsWithSeveralPhases(links: { childId: number; parentId: number }[]): number[] {
  const perChild = new Map<number, number>();
  for (const link of links) {
    perChild.set(link.childId, (perChild.get(link.childId) ?? 0) + 1);
  }
  return [...perChild.entries()].filter(([, count]) => count > 1).map(([childId]) => childId);
}
