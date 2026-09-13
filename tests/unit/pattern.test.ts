import { describe, expect, it } from "vitest";
import {
  hatchPlan,
  hatchSegments,
  MAX_HATCH_LINES,
  patternLineCount,
  patternSegments,
  rotatedBounds,
} from "@/lib/render/pattern";

/**
 * Hatch generation (FR-20.12, NFR-40).
 *
 * The two promises these tests hold are the ones the requirement makes: the
 * pattern is resolution-independent (spacing is a fraction of the picture, so
 * the caller scales it), and it is bounded — a full-pitch zone can never ask for
 * enough lines to make a repaint or an export slow.
 */

const BOX = { x: 0, y: 0, w: 400, h: 300 };

describe("hatch lines", () => {
  it("spaces horizontal lines evenly across the box at angle zero", () => {
    const segments = hatchSegments(BOX, 50, 0);
    expect(segments).toHaveLength(6);

    for (const [from, to] of segments) {
      expect(from[1]).toBeCloseTo(to[1]);
      expect(from[0]).toBeCloseTo(BOX.x);
      expect(to[0]).toBeCloseTo(BOX.x + BOX.w);
    }
    expect(segments.map(([from]) => from[1])).toEqual([25, 75, 125, 175, 225, 275]);
  });

  it("turns the lines with the angle", () => {
    const segments = hatchSegments({ x: 0, y: 0, w: 100, h: 100 }, 20, Math.PI / 4);
    const [[from, to]] = segments;
    const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
    expect(Math.abs(angle)).toBeCloseTo(Math.PI / 4, 5);
  });

  it("covers the rotated box, not the upright one", () => {
    const box = { x: 0, y: 0, w: 100, h: 100 };
    const upright = rotatedBounds(box, 0);
    const tilted = rotatedBounds(box, Math.PI / 4);
    expect(upright.h).toBeCloseTo(100);
    // A square turned 45° needs √2 times the height to be covered.
    expect(tilted.h).toBeCloseTo(100 * Math.SQRT2, 4);
  });

  it("is deterministic: the same inputs give the same lines", () => {
    expect(patternSegments(BOX, 30, -Math.PI / 4, "crossHatch")).toEqual(
      patternSegments(BOX, 30, -Math.PI / 4, "crossHatch"),
    );
  });

  it("gives cross-hatch both directions", () => {
    const single = patternSegments(BOX, 50, 0, "hatch").length;
    const crossed = patternSegments(BOX, 50, 0, "crossHatch").length;
    // A wide box needs more lines across than along, so the second direction is
    // its own count rather than a copy of the first.
    const other = hatchSegments(BOX, 50, Math.PI / 2).length;
    expect(crossed).toBe(single + other);
    expect(crossed).toBeGreaterThan(single);
  });
});

describe("the line cap", () => {
  it("grows the spacing rather than the count", () => {
    // A 1080-px zone at the smallest allowed spacing would ask for hundreds.
    const tall = { x: 0, y: 0, w: 1920, h: 1080 };
    const plan = hatchPlan(tall, 1920 * 0.002, 0);
    expect(plan.count).toBeLessThanOrEqual(MAX_HATCH_LINES);
    expect(plan.spacing).toBeGreaterThan(1920 * 0.002);
    // The grown spacing still covers the box, so nothing is left unpainted.
    expect(plan.spacing * plan.count).toBeGreaterThanOrEqual(tall.h);
  });

  it("never exceeds the cap, cross-hatch included", () => {
    const tall = { x: 0, y: 0, w: 1920, h: 1080 };
    expect(patternSegments(tall, 1, 0, "hatch").length).toBeLessThanOrEqual(MAX_HATCH_LINES);
    // Both directions share the budget instead of each taking a full one.
    expect(patternSegments(tall, 1, 0, "crossHatch").length).toBeLessThanOrEqual(MAX_HATCH_LINES);
  });

  it("agrees with the count it reports", () => {
    expect(patternLineCount(BOX, 40, "hatch")).toBe(patternSegments(BOX, 40, 0, "hatch").length);
    expect(patternLineCount(BOX, 40, "crossHatch")).toBe(
      patternSegments(BOX, 40, 0, "crossHatch").length,
    );
  });

  it("produces finite numbers for a degenerate box", () => {
    const flat = { x: 10, y: 10, w: 100, h: 0 };
    const segments = hatchSegments(flat, 10, 0);
    expect(segments.length).toBeGreaterThanOrEqual(1);
    expect(
      segments.every(([from, to]) => [...from, ...to].every((value) => Number.isFinite(value))),
    ).toBe(true);
  });
});
