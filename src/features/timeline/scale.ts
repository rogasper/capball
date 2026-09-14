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
 * Where the zoom buttons hold the view still: the playhead.
 *
 * Anchoring on the middle of the lane — the obvious first choice — moves the
 * moment being watched horizontally every time the zoom changes, so on a
 * 50-minute match the user loses the playhead for the sake of zooming in. Holding
 * the playhead is what an editor does, and it is why this is a named function
 * rather than an inline expression.
 *
 * When the playhead is outside the view there is nothing to hold, so the centre
 * of the lane is the fallback: zooming should still feel centred on what is on
 * screen.
 */
export function zoomAnchorX(view: Viewport, timeMs: number): number {
  const x = timeToX(timeMs, view);
  if (x < 0 || x > view.widthPx) return view.widthPx / 2;
  return x;
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

/** JetBrains Mono at the caption size advances about this much per character. */
const LABEL_CHAR_PX = 6.6;
/** The inset a label sits at from its tick. */
const LABEL_INSET_PX = 4;

/** Clear air between two labels, so a ruler never reads as a smear. */
export const TICK_LABEL_GAP_PX = 20;

/**
 * How much room a tick label needs for this video.
 *
 * Labels are `MM:SS.mmm`, or `H:MM:SS.mmm` once a match passes an hour, and the
 * difference decides whether a ruler can carry eight labels or only five. Asking
 * for the worst case everywhere would leave a 14-minute match with three ticks.
 */
export function tickLabelPx(durationMs: number): number {
  const characters = durationMs >= 3_600_000 ? 11 : 9;
  return Math.ceil(characters * LABEL_CHAR_PX) + LABEL_INSET_PX;
}

export type Tick = {
  x: number;
  timeMs: number;
  /**
   * False for the last tick when its label would run past the lane.
   *
   * The label is dropped rather than moved to the other side of its tick: moving
   * it lands it on top of its neighbour, which is worse than an unlabelled tick.
   * The line is still drawn, so the ruler keeps its rhythm.
   */
  showLabel: boolean;
};

/**
 * Ruler ticks, kept to a readable count whatever the zoom.
 *
 * The step is chosen so the *labels* have room, not merely the ticks: at a step
 * that only fits the ticks, consecutive timecodes end up nearly touching, which
 * is what makes a ruler look broken. A sparser ruler with clear labels reads far
 * better than a dense one that is illegible.
 */
export function layoutTicks(view: Viewport, targetCount = 8): Tick[] {
  const span = visibleSpanMs(view);
  const rough = span / Math.max(1, targetCount);

  // Human-sized steps, with the three- and four-minute rungs included so the
  // jump from two minutes to five is not a cliff in label count.
  const steps = [
    100, 250, 500, 1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 180_000, 240_000,
    300_000, 600_000, 900_000, 1_800_000, 3_600_000,
  ];

  const labelPx = tickLabelPx(view.durationMs);
  const roomForLabel = labelPx + TICK_LABEL_GAP_PX;
  const bigEnough = steps.filter((candidate) => candidate >= rough);
  // Prefer a step whose ticks are far enough apart for their labels; when even
  // the coarsest step is too tight, take it and let the fit check do its work.
  const step =
    bigEnough.find((candidate) => candidate * view.pxPerMs >= roomForLabel) ??
    bigEnough[0] ??
    steps[steps.length - 1];
  if (step === undefined) return [];

  const first = Math.ceil(view.viewStartMs / step) * step;
  const ticks: Tick[] = [];

  for (let timeMs = first; timeMs <= viewEndMs(view); timeMs += step) {
    const x = timeToX(timeMs, view);
    ticks.push({ x, timeMs, showLabel: x + labelPx <= view.widthPx });
  }

  return ticks;
}

/* -------------------------------------------------------------------------- */
/* Event tracks                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Height of one row of bars inside a track, in pixels.
 *
 * WolfCut's ladder is 40/60/80 for picture/sound/text lanes; a tag lane carries
 * a plain bar rather than a filmstrip, so it sits below that ladder — but the
 * first attempt at 16 px was a smear, not a lane. This is the smallest height at
 * which a clip reads as a clip: a body, a labelled centre and grabbable ends.
 */
export const TRACK_ROW_HEIGHT_PX = 30;
/** A bar is never narrower than this, so a zoomed-out event stays clickable. */
export const MIN_BAR_PX = 3;
/** How many sub-rows a single tag's overlapping events may take. */
export const MAX_SUB_ROWS = 3;

export type TrackBar = {
  eventId: number;
  /** Pixels from the left edge of the lane, which is where the ruler starts. */
  left: number;
  width: number;
  /** Where the moment sits inside its own bar, in the same pixels. */
  anchorX: number;
  /** Which row inside the track, when one tag has overlapping events. */
  row: number;
};

/**
 * Colours for tags that have none, chosen so adjacent lanes never match.
 *
 * Every tag in a real library can be colourless — the owner's all are — and a
 * track whose colour is "the muted foreground" is not a track, it is a row. The
 * palette is indexed by the tag's position, not by a hash: two tags that sit next
 * to each other in the taxonomy are guaranteed to differ, which is what the lane
 * needs to be scannable.
 */
const FALLBACK_COLOURS = [
  "#4C8DFF",
  "#F0913A",
  "#34D399",
  "#F26D6D",
  "#A78BFA",
  "#22D3EE",
  "#FBBF24",
  "#F472B6",
  "#84CC16",
  "#60A5FA",
];

export function fallbackTrackColour(index: number): string {
  return FALLBACK_COLOURS[index % FALLBACK_COLOURS.length] ?? "#4C8DFF";
}

export type Track = {
  tagId: number;
  label: string;
  colour: string | null;
  /** The key this tag is bound to, which is how the moment was tagged. */
  shortcutKey: string | null;
  eventCount: number;
  rows: number;
  bars: TrackBar[];
};

/**
 * Lays the timeline out as **one track per tag**, the way an editor does.
 *
 * This is the shape LiveTag has and capball did not: a named, coloured lane per
 * tag with its key binding, so the timeline reads as "these are my concepts and
 * here is when each happened" rather than as an undifferentiated pile of marks.
 * A tag's own overlapping events take sub-rows inside its lane, so a tag with two
 * events at once is still one track.
 *
 * Track order is the taxonomy's order — the user's own ordering — and not by
 * activity, so the lanes do not rearrange themselves as a match is tagged.
 */
export function layoutTracks(
  events: { id: number; startMs: number; endMs: number; anchorMs: number; tagId: number }[],
  tags: { id: number; name: string; color: string | null; shortcutKey: string | null }[],
  view: Viewport,
  maxSubRows = MAX_SUB_ROWS,
): Track[] {
  const byTag = new Map<number, typeof events>();
  for (const event of events) {
    const list = byTag.get(event.tagId);
    if (list) list.push(event);
    else byTag.set(event.tagId, [event]);
  }

  const ordered = [...tags].sort((a, b) => a.id - b.id);
  const tracks: Track[] = [];

  for (const tag of ordered) {
    const list = byTag.get(tag.id);
    if (!list || list.length === 0) continue;

    const sorted = [...list].sort((a, b) => a.startMs - b.startMs || a.id - b.id);
    const rowEnds: number[] = [];
    const bars: TrackBar[] = [];

    for (const event of sorted) {
      const startX = timeToX(event.startMs, view);
      const endX = timeToX(event.endMs, view);

      // Outside the viewport, with a bar's width of margin so a partial bar draws.
      if (endX < -MIN_BAR_PX || startX > view.widthPx + MIN_BAR_PX) continue;

      const left = Math.max(-MIN_BAR_PX, startX);
      const width = Math.max(MIN_BAR_PX, Math.min(endX, view.widthPx + MIN_BAR_PX) - left);

      let row = rowEnds.findIndex((end) => end <= left);
      if (row === -1) {
        if (rowEnds.length < maxSubRows) {
          row = rowEnds.length;
          rowEnds.push(left + width);
        } else {
          row = maxSubRows - 1;
          rowEnds[row] = Math.max(rowEnds[row], left + width);
        }
      } else {
        rowEnds[row] = left + width;
      }

      bars.push({
        eventId: event.id,
        left,
        width,
        anchorX: timeToX(event.anchorMs, view),
        row,
      });
    }

    // A track keeps its lane even when nothing of it is in view: a lane that
    // disappears as you zoom reads as the timeline losing its tracks, and the
    // empty lane is what tells you *where* to scroll back to.
    tracks.push({
      tagId: tag.id,
      label: tag.name,
      // The tag's own colour when it has one, otherwise a distinct lane colour.
      colour: tag.color ?? fallbackTrackColour(tracks.length),
      shortcutKey: tag.shortcutKey,
      eventCount: list.length,
      rows: Math.max(1, rowEnds.length),
      bars,
    });
  }

  return tracks;
}
