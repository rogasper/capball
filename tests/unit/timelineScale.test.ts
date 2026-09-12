import { describe, expect, it } from "vitest";
import {
  clampViewport,
  fitToDuration,
  followPlayhead,
  layoutMarkers,
  layoutTicks,
  MAX_PX_PER_MS,
  panBy,
  TICK_LABEL_GAP_PX,
  tickLabelPx,
  timeToX,
  type Viewport,
  viewEndMs,
  xToTime,
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

describe("layoutMarkers", () => {
  const events = Array.from({ length: 500 }, (_, index) => ({
    id: index + 1,
    anchorMs: Math.round((index / 500) * match),
  }));

  it("draws every event separately when there is room", () => {
    // Zoomed in so the 500 events are spread far apart.
    const laid = layoutMarkers(events, view({ pxPerMs: 0.05, viewStartMs: 0 }));
    expect(laid.length).toBeGreaterThan(0);
    expect(laid.every((item) => item.kind === "marker" || item.kind === "cluster")).toBe(true);
  });

  it("bounds the rendered items when zoomed out, however many events there are", () => {
    const laid = layoutMarkers(events, fitToDuration(width, match));
    const budget = Math.ceil(width / 5) + 1;
    expect(laid.length).toBeLessThanOrEqual(budget);
  });

  it("keeps every event accounted for in the buckets", () => {
    const laid = layoutMarkers(events, fitToDuration(width, match));
    const counted = laid.reduce(
      (total, item) => total + (item.kind === "cluster" ? item.eventIds.length : 1),
      0,
    );
    expect(counted).toBe(events.length);
  });

  it("skips what is outside the viewport", () => {
    const laid = layoutMarkers(events, view({ pxPerMs: 0.05, viewStartMs: 0 }));
    for (const item of laid) {
      expect(item.x).toBeGreaterThan(-10);
      expect(item.x).toBeLessThan(width + 10);
    }
  });

  it("is unaffected by the order the events arrive in", () => {
    const shuffled = [...events].reverse();
    expect(layoutMarkers(shuffled, fitToDuration(width, match))).toEqual(
      layoutMarkers(events, fitToDuration(width, match)),
    );
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
