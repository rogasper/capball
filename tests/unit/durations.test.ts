import { describe, expect, it } from "vitest";
import {
  actionsWithSeveralPhases,
  countActionsPerPhase,
  durationsByTag,
  type PhaseSpan,
  totalDurationMs,
} from "@/lib/analysis/durations";

/**
 * Duration as its own measure (FR-50.5).
 *
 * A duration and a count answer different questions, so the tests here are about
 * the duration staying honest: clamped to its own footage, never derived from a
 * moment's padding, and explicit when an action is counted for two phases.
 */

const span = (tagId: number, startMs: number, endMs: number, teamId: number | null = null) => ({
  tagId,
  teamId,
  startMs,
  endMs,
});

describe("total time in phase", () => {
  it("adds spans up", () => {
    expect(totalDurationMs([span(1, 0, 60_000), span(1, 120_000, 180_000)], 861_737)).toBe(120_000);
  });

  it("clamps a span that claims time past the end of its video", () => {
    // A phase trimmed over the end contributes the footage it has, not the claim.
    expect(totalDurationMs([span(1, 800_000, 900_000)], 861_737)).toBe(61_737);
  });

  it("ignores a span that has no length or is entirely outside", () => {
    expect(totalDurationMs([span(1, 5_000, 5_000), span(1, 900_000, 950_000)], 861_737)).toBe(0);
  });
});

describe("duration per tag", () => {
  const spans: PhaseSpan[] = [
    span(1, 0, 60_000, 5),
    span(2, 60_000, 90_000, 5),
    span(1, 120_000, 150_000, 9),
  ];

  it("groups by tag and counts the phases behind the number", () => {
    const totals = durationsByTag(spans, 861_737);
    expect(totals).toEqual([
      { tagId: 1, teamId: null, durationMs: 90_000, phaseCount: 2 },
      { tagId: 2, teamId: null, durationMs: 30_000, phaseCount: 1 },
    ]);
  });

  it("splits by team when the team is part of the grouping", () => {
    const totals = durationsByTag(spans, 861_737, { byTeam: true });
    // Longest first, and ties broken by tag then team, so the order never depends
    // on the order the rows arrived in.
    expect(totals.map((total) => [total.tagId, total.teamId, total.durationMs])).toEqual([
      [1, 5, 60_000],
      [1, 9, 30_000],
      [2, 5, 30_000],
    ]);
  });

  it("is stable: the same input produces the same order", () => {
    const once = durationsByTag(spans, 861_737, { byTeam: true });
    const again = durationsByTag([...spans].reverse(), 861_737, { byTeam: true });
    expect(again).toEqual(once);
  });
});

describe("actions counted per phase", () => {
  const links = [
    { childId: 5, parentId: 1 },
    { childId: 5, parentId: 2 },
    { childId: 6, parentId: 1 },
  ];

  it("counts an action for every phase it belongs to", () => {
    const counts = countActionsPerPhase(links);
    expect(counts.get(1)).toBe(2);
    expect(counts.get(2)).toBe(1);
  });

  it("names the actions that are counted twice, so a view can say so", () => {
    // The links sum to more than the number of events, and this is the number
    // that explains the difference rather than hiding it (OQ-R2-16).
    expect(actionsWithSeveralPhases(links)).toEqual([5]);
    expect(actionsWithSeveralPhases([{ childId: 5, parentId: 1 }])).toEqual([]);
  });
});
