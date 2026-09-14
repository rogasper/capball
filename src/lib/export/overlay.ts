import { sortByLayer } from "@/lib/annotate/primitives";
import type { Annotation } from "@/lib/annotate/types";
import { resolveWindow, type WindowContext } from "@/lib/annotate/window";

/**
 * Turning an event's drawings into overlay inputs for one exported clip
 * (FR-40.1, technical-design-R1 §9).
 *
 * Two things make this worth its own pure module, and both are the kind of error
 * that only shows up in the exported file:
 *
 * 1. **The time shift.** Every `enable` expression is relative to the exported
 *    clip, not to the source video. Getting it wrong shifts every drawing by the
 *    clip start — this milestone's version of the M3 anchor bug.
 * 2. **Shared intervals.** Shapes with different windows must not be merged into
 *    one overlay, or a shape appears while its neighbour is still hidden. The
 *    visible set is computed between consecutive window boundaries instead, so a
 *    PNG is only reused where the set is genuinely identical.
 */

export type OverlayInterval = {
  /** Clip-relative, so 0 is the first frame of the export. */
  startMs: number;
  endMs: number;
  annotations: Annotation[];
};

export type OverlayPlan = {
  intervals: OverlayInterval[];
  /** Drawings whose window does not touch this clip at all. */
  skipped: number;
};

/** `between(t,0.000,2.500)`, the expression FFmpeg's `overlay` understands. */
export function enableExpression(startMs: number, endMs: number): string {
  return `between(t,${seconds(startMs)},${seconds(endMs)})`;
}

function seconds(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(3);
}

/**
 * The intervals a set of annotations occupies inside a clip.
 *
 * `context` must carry the clip range (`clipStartMs`/`clipEndMs`), because a
 * `'clip'` window cannot be resolved without it. Everything returned is
 * clip-relative and clamped to the clip, so nothing spans beyond the export.
 */
export function buildOverlayPlan(
  annotations: Annotation[],
  context: WindowContext,
  options: { spanClipWhenEmpty?: boolean } = {},
): OverlayPlan {
  const clipStart = context.clipStartMs ?? context.eventStartMs;
  const clipEnd = context.clipEndMs ?? context.eventEndMs;
  const durationMs = Math.max(0, clipEnd - clipStart);

  const windows = new Map<number, { startMs: number; endMs: number }>();
  let skipped = 0;

  for (const annotation of annotations) {
    const absolute = resolveWindow(annotation, context);
    const startMs = Math.max(0, Math.min(durationMs, absolute.startMs - clipStart));
    const endMs = Math.max(0, Math.min(durationMs, absolute.endMs - clipStart));

    if (endMs <= startMs) {
      skipped += 1;
      continue;
    }
    windows.set(annotation.id, { startMs, endMs });
  }

  if (windows.size === 0) {
    // Nothing to draw over the picture — but an **inset** is on screen for the
    // whole clip whatever the drawings do, so a caller that asked for one needs
    // an interval to hang it on. Without this the pitch would be missing from
    // exactly the clips that have positions and no shapes, which is most of them.
    return options.spanClipWhenEmpty
      ? { intervals: [{ startMs: 0, endMs: durationMs, annotations: [] }], skipped }
      : { intervals: [], skipped };
  }

  // Every point where the visible set can change. Shapes with the same window
  // contribute the same boundaries, so they collapse into one interval and one
  // PNG without any explicit merge step.
  const boundaries = [
    ...new Set([...windows.values()].flatMap((window) => [window.startMs, window.endMs])),
  ].sort((a, b) => a - b);

  const ordered = sortByLayer(annotations);
  const intervals: OverlayInterval[] = [];

  for (let i = 0; i < boundaries.length - 1; i++) {
    const startMs = boundaries[i];
    const endMs = boundaries[i + 1];
    if (endMs <= startMs) continue;

    const at = (startMs + endMs) / 2;
    const visible = ordered.filter((annotation) => {
      const window = windows.get(annotation.id);
      return window !== undefined && at >= window.startMs && at <= window.endMs;
    });
    if (visible.length === 0) continue;

    intervals.push({ startMs, endMs, annotations: visible });
  }

  return { intervals, skipped };
}

/** The overlay inputs a clip's plan resolves to, once each PNG has a path. */
export function overlayInputs(
  intervals: OverlayInterval[],
  pathFor: (interval: OverlayInterval, index: number) => string,
): { path: string; enable: string }[] {
  return intervals.map((interval, index) => ({
    path: pathFor(interval, index),
    enable: enableExpression(interval.startMs, interval.endMs),
  }));
}
