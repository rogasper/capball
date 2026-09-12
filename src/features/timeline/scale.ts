/**
 * Timeline geometry.
 *
 * All of it is pure so the interaction rules can be tested without a DOM, and so
 * the render cost is decided here rather than discovered in the browser: at full
 * zoom-out a match can hold hundreds of events inside a few hundred pixels, and
 * `layoutMarkers` collapses them into bounded buckets instead of drawing them all.
 */

export type Viewport = {
  /** Time at the left edge. */
  viewStartMs: number;
  /** Horizontal scale. */
  pxPerMs: number;
  widthPx: number;
  durationMs: number;
};

export const MIN_PX_PER_MS = 0.00002;
export const MAX_PX_PER_MS = 0.5;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function timeToX(timeMs: number, view: Viewport): number {
  return (timeMs - view.viewStartMs) * view.pxPerMs;
}

export function xToTime(x: number, view: Viewport): number {
  return view.viewStartMs + x / view.pxPerMs;
}

export function visibleSpanMs(view: Viewport): number {
  return view.widthPx / view.pxPerMs;
}

export function viewEndMs(view: Viewport): number {
  return view.viewStartMs + visibleSpanMs(view);
}

/** The whole match fills the width. */
export function fitToDuration(widthPx: number, durationMs: number): Viewport {
  const safeDuration = Math.max(1, durationMs);
  const safeWidth = Math.max(1, widthPx);

  return clampViewport({
    widthPx: safeWidth,
    durationMs: safeDuration,
    pxPerMs: clamp(safeWidth / safeDuration, MIN_PX_PER_MS, MAX_PX_PER_MS),
    viewStartMs: 0,
  });
}

/**
 * Keeps the view inside the match: never before the start, and never past the
 * end unless the visible span is already longer than the match.
 */
export function clampViewport(view: Viewport): Viewport {
  const pxPerMs = clamp(view.pxPerMs, MIN_PX_PER_MS, MAX_PX_PER_MS);
  const span = view.widthPx / pxPerMs;
  const maxStart = Math.max(0, view.durationMs - span);

  return {
    ...view,
    pxPerMs,
    viewStartMs: span >= view.durationMs ? 0 : clamp(view.viewStartMs, 0, maxStart),
  };
}

/** Zooms while keeping the time under `anchorX` exactly where it is. */
export function zoomAt(view: Viewport, factor: number, anchorX: number): Viewport {
  const pxPerMs = clamp(view.pxPerMs * factor, MIN_PX_PER_MS, MAX_PX_PER_MS);
  const anchorTime = xToTime(anchorX, view);

  return clampViewport({ ...view, pxPerMs, viewStartMs: anchorTime - anchorX / pxPerMs });
}

/**
 * Moves the window through time: a positive `deltaPx` looks later in the match,
 * so the content slides left. A drag handler therefore passes the negated
 * pointer delta, because dragging right should reveal earlier footage.
 */
export function panBy(view: Viewport, deltaPx: number): Viewport {
  return clampViewport({ ...view, viewStartMs: view.viewStartMs + deltaPx / view.pxPerMs });
}

/**
 * Scrolls just enough for the playhead to be visible again (FR-3.2).
 *
 * Forward only once the playhead crosses the right margin, and backward only
 * when it has actually left the view — chasing it inside the left margin would
 * make the lane creep on every frame during normal playback.
 */
export function followPlayhead(view: Viewport, timeMs: number, marginShare = 0.15): Viewport {
  const span = visibleSpanMs(view);
  const margin = span * marginShare;

  if (timeMs < view.viewStartMs) {
    return clampViewport({ ...view, viewStartMs: timeMs - margin });
  }
  if (timeMs > viewEndMs(view) - margin) {
    return clampViewport({ ...view, viewStartMs: timeMs + margin - span });
  }
  return view;
}

export type MarkerLayout =
  | { kind: "marker"; eventId: number; x: number }
  | { kind: "cluster"; x: number; eventIds: number[] };

/**
 * Positions markers, merging any that would overlap into a single bucket.
 *
 * The number of rendered items is therefore bounded by `widthPx / minSpacingPx`,
 * which is what keeps a heavily tagged match responsive and legible when zoomed
 * out — one bucket reads as "there is activity here" rather than a smear of
 * unreadable ticks.
 */
export function layoutMarkers(
  events: { id: number; anchorMs: number }[],
  view: Viewport,
  minSpacingPx = 5,
): MarkerLayout[] {
  const rendered: MarkerLayout[] = [];
  const ordered = [...events].sort((a, b) => a.anchorMs - b.anchorMs);

  for (const event of ordered) {
    const x = timeToX(event.anchorMs, view);

    // Outside the viewport, plus a small margin so partially visible ticks draw.
    if (x < -minSpacingPx || x > view.widthPx + minSpacingPx) continue;

    const previous = rendered.at(-1);
    if (previous && x - previous.x < minSpacingPx) {
      if (previous.kind === "cluster") {
        previous.eventIds.push(event.id);
      } else {
        rendered[rendered.length - 1] = {
          kind: "cluster",
          x: previous.x,
          eventIds: [previous.eventId, event.id],
        };
      }
      continue;
    }

    rendered.push({ kind: "marker", eventId: event.id, x });
  }

  return rendered;
}

/** Ruler ticks, kept to a readable count whatever the zoom. */
export function layoutTicks(view: Viewport, targetCount = 8): { x: number; timeMs: number }[] {
  const span = visibleSpanMs(view);
  const rough = span / Math.max(1, targetCount);

  const steps = [
    100, 250, 500, 1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000,
    900_000, 1_800_000, 3_600_000,
  ];
  const step = steps.find((candidate) => candidate >= rough) ?? steps[steps.length - 1];
  if (step === undefined) return [];

  const first = Math.ceil(view.viewStartMs / step) * step;
  const ticks: { x: number; timeMs: number }[] = [];

  for (let timeMs = first; timeMs <= viewEndMs(view); timeMs += step) {
    ticks.push({ x: timeToX(timeMs, view), timeMs });
  }

  return ticks;
}
