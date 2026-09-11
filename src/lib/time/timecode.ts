/**
 * Time helpers. Every time in capball is an integer number of milliseconds;
 * see plans/technical-design.md §7.
 */

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

/** Formats a duration as `MM:SS.mmm`, or `H:MM:SS.mmm` past an hour. */
export function formatTimecode(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  const millis = safe % 1000;

  const base = `${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`;
  return hours > 0 ? `${hours}:${base}` : base;
}

/**
 * Parses `MM:SS`, `H:MM:SS`, or either with `.mmm` / `.s` fractions.
 * Returns null for anything it cannot read confidently.
 */
export function parseTimecode(text: string): number | null {
  const match = text.trim().match(/^(?:(\d+):)?(\d{1,3}):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (!match) return null;

  const [, hours, minutes, seconds, fraction] = match;
  const minuteValue = Number(minutes);
  const secondValue = Number(seconds);

  // Seconds are always bounded. Minutes are only bounded when an hours field is
  // present: "78:32" is a legitimate match timecode, "1:99:00" is not.
  if (secondValue > 59) return null;
  if (hours !== undefined && minuteValue > 59) return null;

  const fractionMs = fraction ? Number(fraction.padEnd(3, "0")) : 0;
  return Number(hours ?? 0) * 3_600_000 + minuteValue * 60_000 + secondValue * 1000 + fractionMs;
}

/** Duration of a single frame, derived from a rational frame rate. */
export function frameDurationMs(fpsNum: number | null, fpsDen: number | null): number | null {
  if (!fpsNum || !fpsDen) return null;
  return (1000 * fpsDen) / fpsNum;
}

/**
 * The clip range around a tagged moment (FR-5.2), clamped to the video bounds
 * so an event near the start or end never produces an invalid range.
 */
export function clipRange(
  centerMs: number,
  preRollMs: number,
  postRollMs: number,
  durationMs: number,
): { startMs: number; endMs: number } {
  const start = Math.max(0, centerMs - preRollMs);
  const end = Math.min(durationMs, centerMs + postRollMs);
  return {
    startMs: Math.round(start),
    endMs: Math.round(Math.max(start, end)),
  };
}

/** Moves the playhead by one frame, staying inside the video. */
export function stepFrames(
  timeMs: number,
  frames: number,
  fpsNum: number | null,
  fpsDen: number | null,
  durationMs: number,
): number {
  const frameMs = frameDurationMs(fpsNum, fpsDen);
  if (frameMs === null) return timeMs;
  return Math.min(durationMs, Math.max(0, timeMs + frames * frameMs));
}
