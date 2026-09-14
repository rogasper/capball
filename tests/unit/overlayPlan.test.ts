import { describe, expect, it } from "vitest";
import { type Annotation, DEFAULT_STYLE } from "@/lib/annotate/types";
import type { WindowContext } from "@/lib/annotate/window";
import { buildOverlayPlan, enableExpression, overlayInputs } from "@/lib/export/overlay";

/**
 * The burn-in plan (FR-40.1, technical-design-R1 §9.2).
 *
 * The clip-relative shift is the error this file exists to catch: every drawing
 * off by the clip start is this milestone's version of the M3 anchor bug, and it
 * is only visible in the exported file. The interval split is the other one — a
 * shape must not appear while its neighbour's window is still closed.
 */

function shape(id: number, patch: Partial<Annotation> = {}): Annotation {
  return {
    id,
    uid: `uid-${id}`,
    eventId: 1,
    kind: "arrow",
    windowMode: "moment",
    windowMs: 2_000,
    geometry: { x: 0.1, y: 0.1, w: 0.2, h: 0.2, rotation: 0 },
    style: { ...DEFAULT_STYLE },
    label: null,
    z: id,
    ...patch,
  };
}

/** The event's own range is the clip here, so relative times are easy to read. */
const context: WindowContext = {
  anchorMs: 100_000,
  eventStartMs: 92_000,
  eventEndMs: 112_000,
  durationMs: 861_737,
  clipStartMs: 92_000,
  clipEndMs: 112_000,
};

describe("enableExpression", () => {
  it("writes seconds with three decimals, as ffmpeg reads them", () => {
    expect(enableExpression(0, 2_500)).toBe("between(t,0.000,2.500)");
    expect(enableExpression(4_000, 6_500)).toBe("between(t,4.000,6.500)");
  });

  it("never writes a negative start", () => {
    expect(enableExpression(-500, 1_000)).toBe("between(t,0.000,1.000)");
  });
});

describe("buildOverlayPlan", () => {
  it("shifts a moment window by the clip start", () => {
    // The drawing's own moment is 100:00, the clip starts at 92:00, so it must
    // be enabled 8 seconds into the exported file — not 100.
    const plan = buildOverlayPlan([shape(1)], context);

    expect(plan.intervals).toHaveLength(1);
    expect(plan.intervals[0]).toMatchObject({ startMs: 7_000, endMs: 9_000 });
  });

  it("gives shapes with the same window one shared interval", () => {
    const plan = buildOverlayPlan([shape(1), shape(2)], context);

    expect(plan.intervals).toHaveLength(1);
    expect(plan.intervals[0]?.annotations.map((annotation) => annotation.id)).toEqual([1, 2]);
  });

  it("splits where the visible set changes, so a shape is never early", () => {
    // A is on for 2 s, B for 4 s from the same moment: B alone, then both, then
    // B alone again. One interval covering all of it would show A for too long.
    const plan = buildOverlayPlan([shape(1), shape(2, { windowMs: 4_000 })], context);

    expect(
      plan.intervals.map((interval) => ({
        startMs: interval.startMs,
        endMs: interval.endMs,
        ids: interval.annotations.map((annotation) => annotation.id),
      })),
    ).toEqual([
      { startMs: 6_000, endMs: 7_000, ids: [2] },
      { startMs: 7_000, endMs: 9_000, ids: [1, 2] },
      { startMs: 9_000, endMs: 10_000, ids: [2] },
    ]);
  });

  it("resolves a clip-wide window against the exported range", () => {
    const plan = buildOverlayPlan([shape(1, { windowMode: "clip" })], context);

    expect(plan.intervals).toHaveLength(1);
    expect(plan.intervals[0]).toMatchObject({ startMs: 0, endMs: 20_000 });
  });

  it("resolves an event-wide window against the event's stored range", () => {
    const plan = buildOverlayPlan([shape(1, { windowMode: "event" })], context);

    expect(plan.intervals[0]).toMatchObject({ startMs: 0, endMs: 20_000 });
  });

  it("skips a drawing whose window does not touch this clip, and counts it", () => {
    const away = shape(1, { windowMode: "moment", windowMs: 2_000 });
    const plan = buildOverlayPlan([away], { ...context, anchorMs: 500_000 });

    expect(plan.intervals).toEqual([]);
    expect(plan.skipped).toBe(1);
  });

  it("has nothing to do with no drawings", () => {
    expect(buildOverlayPlan([], context)).toEqual({ intervals: [], skipped: 0 });
  });
});

describe("overlayInputs", () => {
  it("pairs each interval's PNG with its clip-relative enable expression", () => {
    const plan = buildOverlayPlan([shape(1), shape(2, { windowMs: 4_000 })], context);
    const inputs = overlayInputs(
      plan.intervals,
      (_interval, index) => `/cache/overlays/${index}.png`,
    );

    expect(inputs).toEqual([
      { path: "/cache/overlays/0.png", enable: "between(t,6.000,7.000)" },
      { path: "/cache/overlays/1.png", enable: "between(t,7.000,9.000)" },
      { path: "/cache/overlays/2.png", enable: "between(t,9.000,10.000)" },
    ]);
  });
});

describe("an inset with no drawings to hang it on (FR-40.2)", () => {
  it("still spans the clip, because the pitch does not come and go", () => {
    // The ordinary case: a moment with positions and no shapes at all. Without
    // this the inset would be missing from exactly those clips.
    const plan = buildOverlayPlan([], context, { spanClipWhenEmpty: true });
    expect(plan.intervals).toHaveLength(1);
    expect(plan.intervals[0]?.startMs).toBe(0);
    // Clip-relative, like every interval in this module: 0 is the clip's first frame.
    expect(plan.intervals[0]?.endMs).toBe(20_000);
    expect(plan.intervals[0]?.annotations).toEqual([]);
  });

  it("is an empty plan when nobody asked for an inset", () => {
    // Unchanged for every existing caller: no drawings, no overlay, so the clip
    // is byte-for-byte what it was before this release.
    expect(buildOverlayPlan([], context).intervals).toEqual([]);
  });
});
