import { describe, expect, it } from "vitest";
import { type Annotation, DEFAULT_STYLE, ownWindowOf, type WindowMode } from "@/lib/annotate/types";
import {
  defaultOwnWindow,
  isVisibleAt,
  mergeWindows,
  resolveWindow,
  type WindowContext,
} from "@/lib/annotate/window";

const ctx: WindowContext = {
  anchorMs: 60_000,
  eventStartMs: 52_000,
  eventEndMs: 72_000,
  durationMs: 5_400_000,
};

function annotation(windowMode: WindowMode, windowMs = 2_500): Annotation {
  return {
    id: 1,
    uid: "u1",
    eventId: 1,
    kind: "rect",
    windowMode,
    windowMs,
    geometry: { x: 0.1, y: 0.1, w: 0.2, h: 0.2, rotation: 0 },
    style: { ...DEFAULT_STYLE },
    label: null,
    z: 0,
  };
}

describe("resolveWindow", () => {
  it("centres a moment window on the anchor", () => {
    expect(resolveWindow(annotation("moment"), ctx)).toEqual({ startMs: 58_750, endMs: 61_250 });
  });

  it("uses the event's own range when asked for it", () => {
    expect(resolveWindow(annotation("event"), ctx)).toEqual({ startMs: 52_000, endMs: 72_000 });
  });

  it("cannot start before the video does", () => {
    const atStart: WindowContext = { ...ctx, anchorMs: 500 };
    expect(resolveWindow(annotation("moment"), atStart)).toEqual({ startMs: 0, endMs: 1_750 });
  });

  it("cannot outlast the video", () => {
    const atEnd: WindowContext = { ...ctx, anchorMs: 5_399_900, durationMs: 5_400_000 };
    expect(resolveWindow(annotation("moment"), atEnd).endMs).toBe(5_400_000);
  });

  it("does not clamp when the duration is not known yet", () => {
    const unknown: WindowContext = { ...ctx, durationMs: 0 };
    expect(resolveWindow(annotation("moment"), unknown).endMs).toBe(61_250);
  });

  it("falls back to the event range for a clip window in the app", () => {
    expect(resolveWindow(annotation("clip"), ctx)).toEqual({ startMs: 52_000, endMs: 72_000 });
  });

  it("resolves a clip window against the exported range when there is one", () => {
    const forExport: WindowContext = { ...ctx, clipStartMs: 50_000, clipEndMs: 74_000 };
    expect(resolveWindow(annotation("clip"), forExport)).toEqual({
      startMs: 50_000,
      endMs: 74_000,
    });
  });

  it("treats a frame on the boundary as visible", () => {
    expect(isVisibleAt(annotation("moment"), 58_750, ctx)).toBe(true);
    expect(isVisibleAt(annotation("moment"), 61_250, ctx)).toBe(true);
    expect(isVisibleAt(annotation("moment"), 58_749, ctx)).toBe(false);
  });
});

describe("mergeWindows", () => {
  it("is empty for no windows", () => {
    expect(mergeWindows([])).toEqual([]);
  });

  it("joins overlapping windows", () => {
    expect(
      mergeWindows([
        { startMs: 0, endMs: 2_000 },
        { startMs: 1_000, endMs: 3_000 },
      ]),
    ).toEqual([{ startMs: 0, endMs: 3_000 }]);
  });

  it("joins windows that merely touch", () => {
    expect(
      mergeWindows([
        { startMs: 0, endMs: 2_000 },
        { startMs: 2_000, endMs: 3_000 },
      ]),
    ).toEqual([{ startMs: 0, endMs: 3_000 }]);
  });

  it("keeps separate windows apart, in order", () => {
    expect(
      mergeWindows([
        { startMs: 8_000, endMs: 9_000 },
        { startMs: 0, endMs: 2_000 },
      ]),
    ).toEqual([
      { startMs: 0, endMs: 2_000 },
      { startMs: 8_000, endMs: 9_000 },
    ]);
  });

  it("absorbs a window contained in another", () => {
    expect(
      mergeWindows([
        { startMs: 0, endMs: 10_000 },
        { startMs: 2_000, endMs: 3_000 },
      ]),
    ).toEqual([{ startMs: 0, endMs: 10_000 }]);
  });
});

describe("a drawing's own range (FR-20.16)", () => {
  const base = () => annotation("moment");

  it("wins over the window mode, which is what puts a drawing where it was drawn", () => {
    // The defect: inside a long passage the event's anchor is where the passage
    // *began*, so a shape drawn ten minutes in resolved to its start. A range of
    // its own is the answer, and it has to come first.
    const shape = { ...base(), ownWindow: { startMs: 620_000, endMs: 630_000 } };
    const passage: WindowContext = {
      ...ctx,
      anchorMs: 600_000,
      eventStartMs: 600_000,
      eventEndMs: 900_000,
    };

    expect(resolveWindow(shape, passage)).toEqual({ startMs: 620_000, endMs: 630_000 });
    expect(isVisibleAt(shape, 625_000, passage)).toBe(true);
    expect(isVisibleAt(shape, 601_000, passage)).toBe(false);
  });

  it("is clamped to the video like every other window", () => {
    const shape = { ...base(), ownWindow: { startMs: 5_399_000, endMs: 5_500_000 } };
    expect(resolveWindow(shape, ctx)).toEqual({ startMs: 5_399_000, endMs: 5_400_000 });
  });

  it("returns to the mode it had when the range is removed", () => {
    expect(resolveWindow(base(), ctx)).toEqual({ startMs: 58_750, endMs: 61_250 });
  });

  it("reads a missing or unreadable range as no range at all", () => {
    // An old row has no such field, and an imported file may carry nonsense: both
    // must behave like the release before this one rather than throwing.
    expect(ownWindowOf(base())).toBeNull();
    expect(ownWindowOf({ ...base(), ownWindow: null })).toBeNull();
    expect(ownWindowOf({ ...base(), ownWindow: { startMs: Number.NaN, endMs: 10 } })).toBeNull();
    expect(ownWindowOf({ ...base(), ownWindow: { startMs: 20, endMs: 10 } })).toEqual({
      startMs: 10,
      endMs: 20,
    });
  });
});

describe("the range a drawing starts with", () => {
  it("begins at the playhead, which is the moment being looked at", () => {
    expect(defaultOwnWindow(60_000, 5_400_000)).toEqual({ startMs: 60_000, endMs: 65_000 });
  });

  it("slides back near the end of the video rather than being clamped to nothing", () => {
    expect(defaultOwnWindow(5_399_000, 5_400_000)).toEqual({
      startMs: 5_395_000,
      endMs: 5_400_000,
    });
  });

  it("stays inside the video when the duration is not known yet", () => {
    expect(defaultOwnWindow(1_000, 0)).toEqual({ startMs: 1_000, endMs: 6_000 });
  });
});
