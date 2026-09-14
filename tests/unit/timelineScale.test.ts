import { describe, expect, it } from "vitest";
import {
  clampViewport,
  fitToDuration,
  followPlayhead,
  layoutTicks,
  layoutTracks,
  MAX_PX_PER_MS,
  panBy,
  TICK_LABEL_GAP_PX,
  tickLabelPx,
  timeToX,
  type Viewport,
  viewEndMs,
  xToTime,
  zoomAnchorX,
  zoomAt,
} from "@/features/timeline/scale";

/** A 14-minute match in an 800 px lane: 0.00095 px per ms, so ~1.05 m per px. */
const match = 861_737;
const width = 800;

function view(overrides: Partial<Viewport> = {}): Viewport {
  return { ...fitToDuration(width, match), ...overrides };
}

describe("coordinate conversion", () => {
  it("round-trips time and pixels", () => {
    const v = view({ pxPerMs: 0.01, viewStartMs: 60_000 });
    expect(timeToX(xToTime(123, v), v)).toBeCloseTo(123, 6);
  });

  it("maps the view start to the left edge", () => {
    const v = view({ pxPerMs: 0.01, viewStartMs: 60_000 });
    expect(timeToX(60_000, v)).toBe(0);
  });
});

describe("fitToDuration", () => {
  it("shows the whole match from the start", () => {
    const v = fitToDuration(width, match);
    expect(v.viewStartMs).toBe(0);
    expect(viewEndMs(v)).toBeCloseTo(match, 0);
  });

  it("never divides by zero on an unknown duration", () => {
    const v = fitToDuration(width, 0);
    expect(Number.isFinite(v.pxPerMs)).toBe(true);
    expect(v.pxPerMs).toBeGreaterThan(0);
  });
});

describe("zoomAt", () => {
  it("keeps the time under the cursor in place", () => {
    const before = view({ pxPerMs: 0.002, viewStartMs: 100_000 });
    const anchorX = 300;
    const anchorTime = xToTime(anchorX, before);

    const after = zoomAt(before, 2, anchorX);

    expect(timeToX(anchorTime, after)).toBeCloseTo(anchorX, 3);
  });

  it("does not zoom past the limits", () => {
    let v = view({ pxPerMs: MAX_PX_PER_MS });
    v = zoomAt(v, 4, 400);
    expect(v.pxPerMs).toBeLessThanOrEqual(MAX_PX_PER_MS);
  });

  it("stays inside the match when zooming out near the start", () => {
    const v = zoomAt(view({ pxPerMs: 0.01, viewStartMs: 5_000 }), 0.1, 0);
    expect(v.viewStartMs).toBeGreaterThanOrEqual(0);
  });
});

describe("clampViewport", () => {
  it("refuses to scroll before the start", () => {
    expect(clampViewport(view({ viewStartMs: -50_000 })).viewStartMs).toBe(0);
  });

  it("refuses to scroll past the end", () => {
    const v = clampViewport(view({ pxPerMs: 0.01, viewStartMs: 10_000_000 }));
    expect(viewEndMs(v)).toBeLessThanOrEqual(match + 1);
  });

  it("pins to the start when the whole match fits", () => {
    expect(clampViewport(view({ viewStartMs: 60_000 })).viewStartMs).toBe(0);
  });
});

describe("panBy", () => {
  it("moves the window later in the match for a positive delta", () => {
    const v = view({ pxPerMs: 0.01, viewStartMs: 60_000 });
    expect(panBy(v, 100).viewStartMs).toBeCloseTo(70_000, 3);
  });

  it("moves earlier for the negated pointer delta a drag would pass", () => {
    const v = view({ pxPerMs: 0.01, viewStartMs: 60_000 });
    expect(panBy(v, -100).viewStartMs).toBeCloseTo(50_000, 3);
  });
});

describe("followPlayhead", () => {
  it("leaves the view alone while the playhead is comfortably inside", () => {
    const v = view({ pxPerMs: 0.01, viewStartMs: 60_000 });
    expect(followPlayhead(v, 70_000)).toBe(v);
  });

  it("scrolls forward when the playhead reaches the right margin", () => {
    const v = view({ pxPerMs: 0.01, viewStartMs: 60_000 });
    const moved = followPlayhead(v, 139_000);
    expect(moved.viewStartMs).toBeGreaterThan(v.viewStartMs);
    expect(timeToX(139_000, moved)).toBeLessThan(v.widthPx);
  });

  it("scrolls back when the playhead is behind the view", () => {
    const v = view({ pxPerMs: 0.01, viewStartMs: 60_000 });
    expect(followPlayhead(v, 10_000).viewStartMs).toBeLessThan(60_000);
  });
});

describe("layoutTicks", () => {
  it("keeps the tick count readable at any zoom", () => {
    for (const pxPerMs of [0.00002, 0.0005, 0.01, 0.2]) {
      const ticks = layoutTicks(view({ pxPerMs, viewStartMs: 100_000 }));
      expect(ticks.length).toBeGreaterThan(0);
      expect(ticks.length).toBeLessThanOrEqual(20);
    }
  });

  it("asks for a wider label only once a match passes an hour", () => {
    expect(tickLabelPx(861_737)).toBeLessThan(tickLabelPx(4_000_000));
    expect(tickLabelPx(3_600_000)).toBe(tickLabelPx(4_000_000));
  });

  it("spaces ticks far enough apart that labels cannot collide", () => {
    // The cramped ruler is the failure this guards: labels that nearly touch
    // read as one smear, so the step has to fit the label, not just the tick.
    for (const pxPerMs of [0.0005, 0.002, 0.01, 0.05]) {
      const v = view({ pxPerMs, viewStartMs: 30_000 });
      const labelled = layoutTicks(v).filter((tick) => tick.showLabel);
      for (let index = 1; index < labelled.length; index++) {
        const gap = labelled[index].x - labelled[index - 1].x;
        // Neighbouring labels must not come within touching distance.
        expect(gap).toBeGreaterThanOrEqual(tickLabelPx(v.durationMs) + TICK_LABEL_GAP_PX);
      }
    }
  });

  it("draws a label only when it fits inside the lane", () => {
    for (const pxPerMs of [0.0005, 0.002, 0.01, 0.05]) {
      const v = view({ pxPerMs, viewStartMs: 30_000 });
      for (const tick of layoutTicks(v)) {
        if (tick.showLabel) {
          expect(tick.x + tickLabelPx(v.durationMs)).toBeLessThanOrEqual(v.widthPx);
        }
      }
    }
  });

  it("still draws the tick itself when its label is dropped", () => {
    const v = view({ pxPerMs: 0.01, viewStartMs: 0 });
    const ticks = layoutTicks(v);
    // The end of the visible span is past the last label that fits, so at least
    // one tick has no label — and it is the last one.
    const unlabelled = ticks.filter((tick) => !tick.showLabel);
    expect(unlabelled.length).toBeGreaterThan(0);
    expect(ticks.at(-1)?.showLabel).toBe(false);
    expect(ticks[0]?.showLabel).toBe(true);
  });

  it("uses whole, human-sized steps", () => {
    const ticks = layoutTicks(view({ pxPerMs: 0.01, viewStartMs: 0 }));
    const gaps = ticks.slice(1).map((tick, index) => tick.timeMs - (ticks[index]?.timeMs ?? 0));
    const unique = new Set(gaps);
    expect(unique.size).toBe(1);
    expect([100, 250, 500, 1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000]).toContain(gaps[0]);
  });
});

describe("laying the timeline out as tracks", () => {
  // 1 000 px over 100 s: 0.01 px per ms, the same scale the other tests use.
  const tracksView = view({ viewStartMs: 0, pxPerMs: 0.01, widthPx: 1_000, durationMs: 100_000 });

  const TAGS = [
    { id: 1, name: "Attack", color: "#4C8DFF", shortcutKey: "1" },
    { id: 2, name: "Pass", color: "#34D399", shortcutKey: "2" },
    { id: 3, name: "Unused", color: null, shortcutKey: null },
  ];

  function event(id: number, tagId: number, startMs: number, endMs: number) {
    return { id, tagId, startMs, endMs, anchorMs: Math.round((startMs + endMs) / 2) };
  }

  it("gives every tag its own track, in the taxonomy's order", () => {
    const tracks = layoutTracks(
      [event(1, 2, 10_000, 20_000), event(2, 1, 0, 30_000)],
      TAGS,
      tracksView,
    );
    // The order is the user's, not the order the events happened in.
    expect(tracks.map((track) => track.label)).toEqual(["Attack", "Pass"]);
    expect(tracks.map((track) => track.tagId)).toEqual([1, 2]);
  });

  it("leaves out a tag with nothing to show, rather than an empty lane", () => {
    const tracks = layoutTracks([event(1, 1, 0, 10_000)], TAGS, tracksView);
    expect(tracks.map((track) => track.label)).toEqual(["Attack"]);
  });

  it("draws each bar from the clip's start to its end, with the moment inside", () => {
    const [track] = layoutTracks([event(1, 1, 10_000, 30_000)], TAGS, tracksView);
    expect(track?.bars).toHaveLength(1);
    expect(track?.bars[0]?.left).toBeCloseTo(100);
    expect(track?.bars[0]?.width).toBeCloseTo(200);
    expect(track?.bars[0]?.anchorX).toBeCloseTo(200);
    expect(track?.bars[0]?.row).toBe(0);
  });

  it("keeps a tag's overlapping events in sub-rows of its own track", () => {
    const [track] = layoutTracks(
      [event(1, 1, 0, 30_000), event(2, 1, 20_000, 50_000), event(3, 1, 60_000, 70_000)],
      TAGS,
      tracksView,
    );
    const rowOf = (id: number) => track?.bars.find((bar) => bar.eventId === id)?.row;
    expect(rowOf(1)).toBe(0);
    expect(rowOf(2)).toBe(1);
    // The third starts after the first finished, so it shares row 0.
    expect(rowOf(3)).toBe(0);
    expect(track?.rows).toBe(2);
  });

  it("keeps a zoomed-out event clickable rather than invisible", () => {
    const zoomedOut = view({
      viewStartMs: 0,
      pxPerMs: 800 / (90 * 60_000),
      widthPx: 800,
      durationMs: 90 * 60_000,
    });
    const [track] = layoutTracks([event(1, 1, 1_000_000, 1_001_000)], TAGS, zoomedOut);
    expect(track?.bars[0]?.width).toBeGreaterThanOrEqual(3);
  });

  it("keeps a track whose events are out of view, with an empty lane", () => {
    // A lane that vanishes as you zoom reads as the timeline losing its tracks;
    // an empty lane is what tells you where to scroll back to.
    const tracks = layoutTracks([event(1, 1, 200_000, 210_000)], TAGS, tracksView);
    expect(tracks.map((track) => track.label)).toEqual(["Attack"]);
    expect(tracks[0]?.bars).toEqual([]);
    expect(tracks[0]?.eventCount).toBe(1);
  });
});

describe("where a zoom holds the view still", () => {
  // A fifty-minute match at a fitted zoom is a hundredth of a pixel per
  // millisecond: the zoom buttons are the only practical way in, and if they
  // anchor on the middle of the lane the playhead walks off screen every press.
  const view: Viewport = { viewStartMs: 0, pxPerMs: 0.001, widthPx: 800, durationMs: match };

  it("anchors on the playhead when it is in view", () => {
    expect(zoomAnchorX(view, 200_000)).toBeCloseTo(200, 6);
  });

  it("anchors on the middle of the lane when the playhead is not in view", () => {
    expect(zoomAnchorX(view, 5_000_000)).toBe(400);
    expect(zoomAnchorX({ ...view, viewStartMs: 300_000 }, 10_000)).toBe(400);
  });

  it("keeps the moment under the playhead where it was", () => {
    // The property the anchor exists for, asserted directly: zoom in and the time
    // under that x is unchanged.
    const anchorX = zoomAnchorX(view, 200_000);
    const before = xToTime(anchorX, view);
    const after = xToTime(anchorX, zoomAt(view, 1.6, anchorX));
    expect(after).toBeCloseTo(before, 6);
  });
});
