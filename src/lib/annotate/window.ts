import type { Annotation } from "./types";

/**
 * When a shape is on screen (FR-20.4).
 *
 * `'clip'` is the reason the mode is stored rather than a pair of resolved
 * times: it cannot be resolved until export time, when the exported range — with
 * its padding — is known. In the app it falls back to the event's own range.
 */
export type WindowContext = {
  anchorMs: number;
  eventStartMs: number;
  eventEndMs: number;
  durationMs: number;
  /** The range an export is cutting, when resolving for one. */
  clipStartMs?: number;
  clipEndMs?: number;
};

export type Window = { startMs: number; endMs: number };

function clampToVideo(range: Window, durationMs: number): Window {
  const limit = durationMs > 0 ? durationMs : Number.POSITIVE_INFINITY;
  const startMs = Math.max(0, Math.min(range.startMs, limit));
  const endMs = Math.max(startMs, Math.min(range.endMs, limit));
  return { startMs: Math.round(startMs), endMs: Math.round(endMs) };
}

export function resolveWindow(annotation: Annotation, ctx: WindowContext): Window {
  switch (annotation.windowMode) {
    case "moment": {
      const half = Math.max(0, annotation.windowMs) / 2;
      return clampToVideo(
        { startMs: ctx.anchorMs - half, endMs: ctx.anchorMs + half },
        ctx.durationMs,
      );
    }
    case "event":
      return clampToVideo({ startMs: ctx.eventStartMs, endMs: ctx.eventEndMs }, ctx.durationMs);
    case "clip": {
      const startMs = ctx.clipStartMs ?? ctx.eventStartMs;
      const endMs = ctx.clipEndMs ?? ctx.eventEndMs;
      return clampToVideo({ startMs, endMs }, ctx.durationMs);
    }
  }
}

export function isVisibleAt(annotation: Annotation, atMs: number, ctx: WindowContext): boolean {
  const { startMs, endMs } = resolveWindow(annotation, ctx);
  return atMs >= startMs && atMs <= endMs;
}

/** The distinct time windows in a set, merged so a burn-in needs fewer overlays. */
export function mergeWindows(windows: Window[]): Window[] {
  if (windows.length === 0) return [];

  const sorted = [...windows].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const merged: Window[] = [{ ...sorted[0] }];

  for (const window of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (window.startMs <= last.endMs) last.endMs = Math.max(last.endMs, window.endMs);
    else merged.push({ ...window });
  }

  return merged;
}
