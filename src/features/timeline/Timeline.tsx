import { Maximize2, Square, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { openEvent } from "@/features/events/openEvent";
import { buildEventDraft } from "@/features/tagging/captureContext";
import { stopPhase, togglePhase } from "@/features/tagging/phaseCapture";
import { durationsByTag } from "@/lib/analysis/durations";
import type { EventRow } from "@/lib/db/queries/events";
import { ON_DEMAND, useThumbnail } from "@/lib/media/thumbnails";
import { describeClosure, type OpenPhase } from "@/lib/phases/rules";
import { playback } from "@/lib/playback";
import { formatDurationMs, formatTimecode } from "@/lib/time/timecode";
import { cn } from "@/lib/utils";
import { applyFilters, isFilterActive, useEventStore } from "@/stores/eventStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { usePhaseStore } from "@/stores/phaseStore";
import { usePlayerStore } from "@/stores/playerStore";
import { useTagStore } from "@/stores/tagStore";
import { FilterBar } from "./FilterBar";
import {
  clampViewport,
  fitToDuration,
  followPlayhead,
  layoutTicks,
  layoutTracks,
  MIN_BAR_PX,
  panBy,
  TRACK_ROW_HEIGHT_PX,
  timeToX,
  type Viewport,
  xToTime,
  zoomAnchorX,
  zoomAt,
} from "./scale";

/**
 * Width of the track header column, in pixels.
 *
 * The ruler's spacer and every track header are sized from this one number, so
 * the time axis and the bars cannot drift apart.
 */
const GUTTER_PX = 132;
/** A bar drag shorter than this is a click, which opens the event. */
const CLICK_SLOP_PX = 3;
const ZOOM_STEP = 1.6;
/**
 * The narrowest bar that can hold two trim handles and a body between them.
 *
 * Below this the whole bar moves and trimming waits for a zoom. The alternative —
 * deciding move-versus-trim from how close the press landed — turns a miss of a
 * few pixels into a clip that jumps sideways instead of trimming, which is the
 * reported "I only wanted to adjust the end and it moved".
 */
const MIN_GRIP_BAR_PX = 26;
/** Width of one trim handle. */
const GRIP_PX = 8;
/** How long the pointer rests on a bar before its preview card appears. */
const HOVER_DELAY_MS = 220;
/** How many clip-lengths a double-click leaves on screen when zooming to a clip. */
const FOCUS_SPAN_FACTOR = 3;

type Selection = { startMs: number; endMs: number };

/** The tag picker shown while a range is selected (FR-3.3). */
function SelectionActions({ selection, onDone }: { selection: Selection; onDone: () => void }) {
  const tags = useTagStore((state) => state.tags);
  const insert = useEventStore((state) => state.insert);
  const reportError = useEventStore((state) => state.reportError);

  const startMs = Math.min(selection.startMs, selection.endMs);
  const endMs = Math.max(selection.startMs, selection.endMs);

  const tagIt = async (tagId: number) => {
    const tag = tags.find((candidate) => candidate.id === tagId);
    if (!tag) return;

    try {
      // A dragged range is already the clip, so nothing is added around it; the
      // moment is where the user started the selection.
      await insert(buildEventDraft(tag, { anchorMs: startMs, startMs, endMs }));
      onDone();
    } catch (error) {
      reportError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5">
      <span className="font-mono text-label tabular-nums text-muted-foreground">
        {formatTimecode(startMs)} → {formatTimecode(endMs)}
      </span>
      <span className="text-label text-muted-foreground">Tag it as</span>
      <span className="flex flex-wrap gap-1">
        {tags.slice(0, 12).map((tag) => (
          <Button key={tag.id} variant="outline" size="xs" onClick={() => void tagIt(tag.id)}>
            {tag.name}
            {tag.shortcutKey && (
              <span className="ml-1 font-mono text-muted-foreground">{tag.shortcutKey}</span>
            )}
          </Button>
        ))}
      </span>
      <Button variant="ghost" size="xs" className="ml-auto" onClick={onDone}>
        Clear
      </Button>
    </div>
  );
}

/** The shortest clip a trim may leave behind, so a bar cannot vanish. */
const MIN_SPAN_MS = 200;

/**
 * The range a drag produces, from where it started and how far it has moved.
 *
 * Both the live preview and the write on release come through here. Deriving the
 * commit from the drag rather than from the preview state matters: the preview
 * lives in React state, and a release that arrives before the re-render would
 * otherwise commit nothing at all.
 */
function rangeFromDrag(
  drag: {
    mode: "move" | "trim-start" | "trim-end";
    originX: number;
    originView: Viewport;
    origin: { startMs: number; endMs: number; anchorMs: number };
  },
  clientX: number,
): { startMs: number; endMs: number; anchorMs: number } {
  const deltaMs = Math.round((clientX - drag.originX) / Math.max(1e-9, drag.originView.pxPerMs));
  const { origin } = drag;

  if (drag.mode === "move") {
    return {
      startMs: Math.max(0, origin.startMs + deltaMs),
      endMs: Math.max(0, origin.endMs + deltaMs),
      anchorMs: Math.max(0, origin.anchorMs + deltaMs),
    };
  }

  if (drag.mode === "trim-start") {
    const startMs = Math.min(origin.endMs - MIN_SPAN_MS, Math.max(0, origin.startMs + deltaMs));
    return {
      startMs,
      endMs: origin.endMs,
      anchorMs: Math.min(origin.endMs, Math.max(startMs, origin.anchorMs)),
    };
  }

  const endMs = Math.max(origin.startMs + MIN_SPAN_MS, origin.endMs + deltaMs);
  return {
    startMs: origin.startMs,
    endMs,
    anchorMs: Math.min(endMs, Math.max(origin.startMs, origin.anchorMs)),
  };
}

export function Timeline() {
  const events = useEventStore((state) => state.events);
  const filters = useEventStore((state) => state.filters);
  const toggleTagFilter = useEventStore((state) => state.toggleTagFilter);

  const storedDuration = useLibraryStore((state) => state.probe?.durationMs ?? 0);
  const liveDuration = usePlayerStore((state) => state.durationMs);
  const durationMs = storedDuration || liveDuration;

  const videos = useLibraryStore((state) => state.videos);
  const activeVideoId = useLibraryStore((state) => state.activeVideoId);
  const sourcePath = useMemo(() => {
    const video = videos.find((candidate) => candidate.id === activeVideoId);
    return video ? (video.playbackPath ?? video.path) : null;
  }, [videos, activeVideoId]);

  const visible = useMemo(() => applyFilters(events, filters), [events, filters]);

  const laneRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [widthPx, setWidthPx] = useState(0);
  const [view, setView] = useState<Viewport | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  const viewRef = useRef<Viewport | null>(null);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // Track the available width so the lane can be fitted and re-fitted.
  useEffect(() => {
    const element = rowsRef.current;
    if (!element) return;

    const update = () => setWidthPx(Math.max(0, element.clientWidth - GUTTER_PX));
    update();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Fit once the lane has been measured and the duration is known.
  useEffect(() => {
    if (widthPx <= 0 || durationMs <= 0) return;
    setView((current) => current ?? fitToDuration(widthPx, durationMs));
  }, [widthPx, durationMs]);

  // A different video is a different time range, so start fitted again — but a
  // resize must not throw away the zoom the user chose.
  const fittedForVideo = useRef<number | null>(null);
  useEffect(() => {
    if (fittedForVideo.current === activeVideoId) return;
    fittedForVideo.current = activeVideoId;
    if (widthPx <= 0 || durationMs <= 0) return;

    setView(fitToDuration(widthPx, durationMs));
    setSelection(null);
  }, [activeVideoId, widthPx, durationMs]);

  const phaseTagIds = usePhaseStore((state) => state.phaseTagIds);
  const openPhases = usePhaseStore((state) => state.open);
  const phaseLinks = usePhaseStore((state) => state.links);
  const phaseClosures = usePhaseStore((state) => state.closures);

  /**
   * Puts the playhead, and the bars of the phases that are running, where the
   * current viewport says they belong.
   *
   * A DOM write rather than state: both change with the viewport *and* with the
   * clock, and either one in state would re-render the timeline per frame
   * (architecture rule 4). It is called from the frame subscription while the
   * video plays, and from an effect whenever the view changes — zooming or
   * panning while paused is exactly when a stale width or an unplaced playhead
   * used to be left behind.
   */
  const placeOverlays = useCallback((current: Viewport, timeMs: number, phases: OpenPhase[]) => {
    const x = timeToX(timeMs, current);
    const element = playheadRef.current;
    if (element) {
      element.style.opacity = x >= -1 && x <= current.widthPx + 1 ? "1" : "0";
      // The track headers are not time, so the playhead starts after them.
      // Without this it sat a gutter's width left of the moment it marks.
      element.style.transform = `translateX(${GUTTER_PX + x}px)`;
    }

    for (const phase of phases) {
      const bar = liveBars.current.get(phase.eventId);
      if (!bar) continue;
      const left = timeToX(phase.startedAtMs, current);
      bar.style.width = `${Math.max(MIN_BAR_PX, timeToX(timeMs, current) - left)}px`;
    }
  }, []);

  // The playhead is driven from the playback controller, never from state, and
  // the view only moves when the playhead would otherwise leave it.
  useEffect(
    () =>
      playback.onFrame((timeMs) => {
        const current = viewRef.current;
        if (!current) return;

        // Read live: this callback is created once and must see the phase that is
        // open now, not the one that was open when the effect ran.
        placeOverlays(current, timeMs, usePhaseStore.getState().open);

        const followed = followPlayhead(current, timeMs);
        if (followed !== current) setView(followed);
      }),
    [placeOverlays],
  );

  // A zoom, a pan or a fit while paused: no frames are running, so this is what
  // keeps the playhead where it should be instead of where the last frame left it.
  useEffect(() => {
    if (view) placeOverlays(view, playback.timeMs, openPhases);
  }, [view, openPhases, placeOverlays]);

  const zoomBy = useCallback((factor: number) => {
    setView((current) =>
      current ? zoomAt(current, factor, zoomAnchorX(current, playback.timeMs)) : current,
    );
  }, []);

  const fit = useCallback(() => {
    setView((current) => (current ? fitToDuration(current.widthPx, current.durationMs) : current));
  }, []);

  // Wheel must be non-passive to prevent the page from scrolling behind the lane.
  useEffect(() => {
    const element = laneRef.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = viewRef.current;
      if (!current) return;

      const bounds = element.getBoundingClientRect();
      const x = event.clientX - bounds.left;

      setView(
        event.ctrlKey || event.metaKey
          ? zoomAt(current, event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, x)
          : panBy(current, event.deltaX || event.deltaY),
      );
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const ticks = useMemo(() => (view ? layoutTicks(view) : []), [view]);
  const tags = useTagStore((state) => state.tags);
  const tracks = useMemo(
    () => (view ? layoutTracks(visible, tags, view) : []),
    [visible, tags, view],
  );

  /** Which phase each action belongs to (FR-55.3), for the bar's own tick. */
  const parentsByChild = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const link of phaseLinks) {
      const list = map.get(link.childId);
      if (list) list.push(link.parentId);
      else map.set(link.childId, [link.parentId]);
    }
    return map;
  }, [phaseLinks]);

  /**
   * A phase tag's recorded time, which is a different measure from its count.
   *
   * Only events with a **session** count: a moment of a phase-tagged tag was
   * captured with pre-roll and post-roll, and adding that padding to a duration
   * is exactly the fiction the phase model exists to remove (FR-50.5).
   */
  const phaseTotals = useMemo(() => {
    const phaseSet = new Set(phaseTagIds);
    const spans = events
      .filter((event) => phaseSet.has(event.tagId) && phaseClosures[event.id] !== undefined)
      .map((event) => ({
        tagId: event.tagId,
        teamId: event.teamId,
        startMs: event.startMs,
        endMs: event.endMs,
      }));
    return new Map(durationsByTag(spans, durationMs).map((total) => [total.tagId, total]));
  }, [events, phaseTagIds, phaseClosures, durationMs]);

  /**
   * The bars of the phases that are running, so their length can be written per
   * frame without React (D40).
   */
  const liveBars = useRef(new Map<number, HTMLElement>());

  /**
   * The bar the pointer has *rested* on, which is the only one that gets a card.
   *
   * A card on every `pointerenter` flashed a thumbnail and a panel as the pointer
   * crossed the lane, which reads as the timeline rearranging itself under the
   * mouse. Resting on a bar is a much better signal that this is the one meant.
   */
  const [hoverShown, setHoverShown] = useState<number | null>(null);
  useEffect(() => {
    if (hovered === null) {
      setHoverShown(null);
      return;
    }
    const timer = window.setTimeout(() => setHoverShown(hovered), HOVER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [hovered]);

  const hoveredEvent = visible.find((event) => event.id === hoverShown) ?? null;
  const { state: hoverThumbnail, ref: hoverRef } = useThumbnail(
    sourcePath,
    hoveredEvent?.anchorMs ?? 0,
    ON_DEMAND,
  );

  type RangeDrag = {
    mode: "move" | "trim-start" | "trim-end";
    eventId: number;
    originX: number;
    originView: Viewport;
    origin: { startMs: number; endMs: number; anchorMs: number };
  };
  type LaneDrag =
    | { mode: "pan"; originX: number; originView: Viewport }
    | { mode: "select"; originX: number; originView: Viewport }
    | RangeDrag;
  const drag = useRef<LaneDrag | null>(null);
  const moved = useRef(false);
  /** A drag's provisional range, drawn while the pointer moves and written on release. */
  const [rangePreview, setRangePreview] = useState<{
    eventId: number;
    startMs: number;
    endMs: number;
    anchorMs: number;
  } | null>(null);

  /**
   * Pointer x inside the lane.
   *
   * Measured against the lane element, not against `event.currentTarget`. Two
   * reasons, and the second one cost a blank window: this is the same frame the
   * time↔pixel maths uses (`widthPx` comes from this element), and the element is
   * still there when a state updater runs — the event's `currentTarget` is
   * cleared once dispatch finishes, so reading it from inside a `setState`
   * callback throws once React gets round to calling it.
   */
  const localX = (clientX: number): number => {
    // The lanes start after the track headers, so the gutter is not time.
    const rows = rowsRef.current;
    if (!rows) return 0;
    return clientX - rows.getBoundingClientRect().left - GUTTER_PX;
  };

  /**
   * Every gesture is captured, and handled, on the lane element itself.
   *
   * Capture and the move/up handlers have to sit on the *same* node. A browser
   * retargets the moves to whichever element captured the pointer, so capturing
   * on a wrapper with no handlers means the gesture is never finished: `drag`
   * stays set, and the next pointer move with **no button held** carries on
   * editing the clip. That is the reported "it changes when I drag around even
   * though I never clicked anything".
   */
  const captureOnLane = (pointerId: number) => {
    laneRef.current?.setPointerCapture(pointerId);
  };

  const beginPan = (event: React.PointerEvent<HTMLElement>) => {
    if (!view) return;
    captureOnLane(event.pointerId);
    drag.current = { mode: "pan", originX: event.clientX, originView: view };
    moved.current = false;
  };

  const beginSelect = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!view) return;
    captureOnLane(event.pointerId);
    drag.current = { mode: "select", originX: event.clientX, originView: view };
    moved.current = false;

    const timeMs = xToTime(localX(event.clientX), view);
    setSelection({ startMs: timeMs, endMs: timeMs });
  };

  /**
   * Takes hold of a span's body, which always moves it.
   *
   * Trimming belongs to the grips and only to the grips: one press cannot mean
   * both, and a proximity test as well as grips is what made a press near an end
   * move the whole clip.
   */
  const beginBarDrag = (pointerEvent: React.PointerEvent<HTMLElement>, event: EventRow) => {
    if (!view) return;
    pointerEvent.stopPropagation();
    captureOnLane(pointerEvent.pointerId);
    drag.current = {
      mode: "move",
      eventId: event.id,
      originX: pointerEvent.clientX,
      originView: view,
      origin: { startMs: event.startMs, endMs: event.endMs, anchorMs: event.anchorMs },
    };
    moved.current = false;
  };

  const beginBarTrim = (
    pointerEvent: React.PointerEvent<HTMLElement>,
    event: EventRow,
    side: "start" | "end",
    shown: { startMs: number; endMs: number; anchorMs: number },
  ) => {
    if (!view) return;
    pointerEvent.stopPropagation();
    captureOnLane(pointerEvent.pointerId);
    drag.current = {
      mode: side === "start" ? "trim-start" : "trim-end",
      eventId: event.id,
      originX: pointerEvent.clientX,
      originView: view,
      origin: shown,
    };
    moved.current = false;
  };

  /** Fills the lane with one clip, so its trim handles come within reach. */
  const zoomToEvent = useCallback((event: { startMs: number; endMs: number }) => {
    setView((current) => {
      if (!current) return current;
      const clipMs = Math.max(MIN_SPAN_MS, event.endMs - event.startMs);
      const pxPerMs = current.widthPx / (clipMs * FOCUS_SPAN_FACTOR);
      const centreMs = (event.startMs + event.endMs) / 2;
      return clampViewport({
        ...current,
        pxPerMs,
        viewStartMs: centreMs - current.widthPx / pxPerMs / 2,
      });
    });
  }, []);

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;

    // A move with no button held is not a drag, whatever `drag` still says: the
    // gesture that set it ended somewhere this element never heard about. Drop it
    // instead of keeping to edit a clip the pointer is no longer holding.
    if (event.buttons === 0) {
      drag.current = null;
      setRangePreview(null);
      return;
    }

    const deltaX = event.clientX - state.originX;
    if (Math.abs(deltaX) > CLICK_SLOP_PX) moved.current = true;

    if (state.mode === "pan") {
      setView(panBy(state.originView, -deltaX));
      return;
    }

    if (state.mode !== "select") {
      // A trim or a move, previewed while the pointer moves and written once.
      setRangePreview({ eventId: state.eventId, ...rangeFromDrag(state, event.clientX) });
      return;
    }

    // Read the geometry now, while the event is still dispatching: a state
    // updater runs during the next render, and by then the event is spent.
    const endMs = xToTime(localX(event.clientX), state.originView);
    setSelection((current) => (current ? { ...current, endMs } : current));
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    drag.current = null;
    if (!state) return;

    // A press that never moved: on a span it opens the event (which is what makes
    // the Draw and Pitch tabs usable from here), on the lane it seeks.
    if (!moved.current) {
      if (state.mode !== "select" && state.mode !== "pan") {
        const target = visible.find((candidate) => candidate.id === state.eventId);
        if (target) openEvent(target);
        setRangePreview(null);
        return;
      }
      const timeMs = xToTime(localX(event.clientX), state.originView);
      playback.seekMs(timeMs);
      if (state.mode === "select") setSelection(null);
      return;
    }

    if (state.mode !== "select" && state.mode !== "pan") {
      // One write per gesture, derived from the drag itself so a release that
      // arrives before React re-renders still commits the range the user saw.
      void useEventStore
        .getState()
        .setEventRange(state.eventId, rangeFromDrag(state, event.clientX));
      setRangePreview(null);
    }
  };

  /** A cancelled gesture leaves nothing behind — no half-applied edit either. */
  const cancelDrag = useCallback(() => {
    drag.current = null;
    setRangePreview(null);
  }, []);

  /**
   * A release anywhere ends the gesture, even if it never reached the lane.
   *
   * Pointer capture is normally released by the browser, but it is not
   * guaranteed: a cancelled pointer or a window that loses focus sends no
   * `pointerup` here. A stale drag is worse than no drag (see `onPointerMove`),
   * so this sweeps up. Window listeners run after React's own — React dispatches
   * from the root container — so a release on the lane still commits first and
   * this only clears what is left.
   */
  useEffect(() => {
    window.addEventListener("pointerup", cancelDrag);
    window.addEventListener("pointercancel", cancelDrag);
    return () => {
      window.removeEventListener("pointerup", cancelDrag);
      window.removeEventListener("pointercancel", cancelDrag);
    };
  }, [cancelDrag]);

  const laneTone = "border-border bg-background";
  const filtered = isFilterActive(filters) && visible.length !== events.length;
  const laneHeight = (rows: number) => Math.max(TRACK_ROW_HEIGHT_PX, rows * TRACK_ROW_HEIGHT_PX);

  return (
    <div className="space-y-2 border-t border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {durationMs > 0 ? (
          <FilterBar />
        ) : (
          <span className="text-label text-muted-foreground">Add a video to see the timeline</span>
        )}

        {/* Hiding is not losing: say what the filter is doing, where the events
            are, rather than only on the chips that turned it on. */}
        {filtered && (
          <span className="text-caption text-warning">
            Filtered — showing {visible.length} of {events.length} events
          </span>
        )}

        {/* While a phase is running, stopping it is a button here rather than a
            press on a bar that may be three pixels wide: at a fitted zoom a
            running phase is barely findable, and losing a passage because its
            bar cannot be hit is not a thing the user can be expected to accept. */}
        {openPhases.map((phase) => {
          const tag = tags.find((candidate) => candidate.id === phase.tagId);
          return (
            <Button
              key={phase.eventId}
              variant="outline"
              size="xs"
              className="gap-1"
              title={`Stop the ${tag?.name ?? "phase"} phase now`}
              onClick={() => stopPhase(phase.streamKey, playback.timeMs)}
            >
              <Square className="size-2.5 fill-current" aria-hidden="true" />
              Stop {tag?.name ?? "phase"}
            </Button>
          );
        })}

        {/* The gestures, said out loud. They used to live in a `title` on the
            whole lane, which painted a tooltip across the tracks as soon as the
            pointer was anywhere near the timeline. */}
        <span className="hidden min-w-0 flex-1 truncate text-caption text-muted-foreground md:block">
          Drag a clip to move it, its ends to trim · double-click to zoom in · scroll to pan ·
          ⌘/Ctrl-scroll to zoom
        </span>

        <span className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom out"
            disabled={!view}
            onClick={() => zoomBy(1 / ZOOM_STEP)}
          >
            <ZoomOut className="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Fit the whole match"
            disabled={!view}
            onClick={fit}
          >
            <Maximize2 className="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom in"
            disabled={!view}
            onClick={() => zoomBy(ZOOM_STEP)}
          >
            <ZoomIn className="size-3.5" aria-hidden="true" />
          </Button>
        </span>
      </div>

      {/* The lane owns every pointer gesture: it captures the pointer, and it is
          the element the move/up/cancel handlers are on. Keeping capture and the
          handlers on one node is what stops a gesture from outliving its button —
          see `captureOnLane`. The wrapper deliberately carries no `title`: one
          covering the whole timeline paints a tooltip over the tracks. */}
      <div
        ref={laneRef}
        className="relative select-none touch-none"
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={cancelDrag}
      >
        {/* The ruler is a row of its own: a gutter-wide spacer, then the time
            axis. The axis has to start where the bars do — drawn across the full
            width, its 00:00 landed under the track headers and every label sat a
            gutter to the left of the moment it named. */}
        <div className={cn("flex border-b", laneTone)}>
          {/* The column of track headers, above the headers. It stays empty: the
              first tick already names the origin, and printing the view's start
              here only repeated it. */}
          <div
            className="shrink-0 border-r border-border"
            style={{ width: `${GUTTER_PX}px` }}
            aria-hidden="true"
          />
          <div
            className="relative h-5 min-w-0 flex-1 cursor-grab overflow-hidden"
            onPointerDown={beginPan}
            role="slider"
            aria-label="Timeline"
            aria-valuemin={0}
            aria-valuemax={Math.round(durationMs)}
            aria-valuenow={Math.round(view ? view.viewStartMs : 0)}
            tabIndex={0}
            title="Click to seek, drag to select a range"
          >
            {ticks.map((tick) => (
              <span
                key={tick.timeMs}
                className="absolute top-0 bottom-0 border-l border-border/70"
                style={{ left: `${tick.x}px` }}
              >
                {/* The last tick keeps its rhythm but drops its label rather
                    than letting the text run past the lane. */}
                {tick.showLabel && (
                  <span className="absolute top-0.5 left-1 font-mono text-caption tabular-nums text-muted-foreground">
                    {formatTimecode(tick.timeMs)}
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>

        {/* The tracks: one row per tag, each with its own header. This is what
            makes the timeline read like an editor rather than a row of marks —
            a named, coloured lane you can scan, trim and click. */}
        {/* The lanes stop growing once they are tall enough to be a surface and
            scroll instead. The minimum applies only when there is nothing in
            them: with tracks, the lane is as tall as its tracks and not a
            hand's width of empty grey. */}
        <div
          ref={rowsRef}
          className="relative max-h-[38vh] overflow-y-auto [scrollbar-gutter:stable]"
          style={tracks.length === 0 ? { minHeight: `${TRACK_ROW_HEIGHT_PX * 3}px` } : undefined}
        >
          {tracks.map((track) => (
            <div key={track.tagId} className="flex border-b border-border/60">
              {/* The header is also the filter: clicking a tag narrows to it. */}
              <button
                type="button"
                className="flex shrink-0 items-center gap-1.5 truncate border-r border-border px-1.5 py-1 text-left text-label hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
                style={{ width: `${GUTTER_PX}px` }}
                title={`${track.label} · ${track.eventCount} event${track.eventCount === 1 ? "" : "s"} — click to filter to this tag`}
                aria-pressed={filters.tagIds.includes(track.tagId)}
                onClick={() => toggleTagFilter(track.tagId)}
              >
                <span
                  className="size-2.5 shrink-0 rounded-sm"
                  style={{ background: track.colour ?? "var(--muted-foreground)" }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate">{track.label}</span>
                {track.shortcutKey && (
                  <span className="shrink-0 font-mono text-caption text-muted-foreground">
                    {track.shortcutKey}
                  </span>
                )}
                {/* A phase's header carries its **time**, which is a different
                    measure from the event count beside it (FR-50.5). */}
                {phaseTotals.get(track.tagId) && (
                  <span
                    className="shrink-0 font-mono text-caption tabular-nums text-muted-foreground"
                    title={`Time recorded in this phase: ${formatDurationMs(
                      phaseTotals.get(track.tagId)?.durationMs ?? 0,
                    )} across ${phaseTotals.get(track.tagId)?.phaseCount ?? 0} phase${
                      (phaseTotals.get(track.tagId)?.phaseCount ?? 0) === 1 ? "" : "s"
                    }`}
                  >
                    {formatDurationMs(phaseTotals.get(track.tagId)?.durationMs ?? 0)}
                  </span>
                )}
                <span className="shrink-0 font-mono text-caption tabular-nums text-muted-foreground">
                  {track.eventCount}
                </span>
                {/* In words, not only in colour: a lane that is recording must
                    say so (NFR-34). */}
                {openPhases.some((phase) => phase.tagId === track.tagId) && (
                  <span className="shrink-0 text-caption text-primary">recording</span>
                )}
              </button>

              {/* A named region per track: it is the accessible handle on "the
                  Attack lane", for a screen reader and for a test alike. Pressing
                  empty lane starts a range selection; the moves and the release
                  belong to the lane wrapper above, which is where the pointer is
                  captured. */}
              <section
                aria-label={`${track.label} track`}
                className="relative min-w-0 flex-1 touch-none bg-muted/20"
                style={{ height: `${laneHeight(track.rows)}px` }}
                onPointerDown={beginSelect}
              >
                {track.bars.map((bar) => {
                  const event = visible.find((candidate) => candidate.id === bar.eventId);
                  if (!event) return null;

                  const shown =
                    rangePreview?.eventId === event.id
                      ? {
                          startMs: rangePreview.startMs,
                          endMs: rangePreview.endMs,
                          anchorMs: rangePreview.anchorMs,
                        }
                      : { startMs: event.startMs, endMs: event.endMs, anchorMs: event.anchorMs };
                  const left = view ? timeToX(shown.startMs, view) : bar.left;
                  const width = view ? Math.max(3, timeToX(shown.endMs, view) - left) : bar.width;
                  const anchorX = view ? timeToX(shown.anchorMs, view) - left : 0;
                  /** Trim handles need room at both ends plus a body between them. */
                  const gripsFit = width >= MIN_GRIP_BAR_PX;

                  const isPhase = phaseTagIds.includes(event.tagId);
                  const recording = openPhases.some((phase) => phase.eventId === event.id);
                  // A phase tag can also hold events that were captured with one
                  // press before it became a phase: they are not runs, and saying
                  // so is the difference between a record and a misreading.
                  const closure = phaseClosures[event.id];
                  const phaseRun = closure !== undefined;
                  const phaseLabel = phaseRun
                    ? `${event.tagName} phase`
                    : `${event.tagName} (one press)`;
                  // A phase's bar shows its real span, so the length it prints is
                  // the passage's own — the one number padding cannot fake.
                  const phaseMs = Math.max(0, shown.endMs - shown.startMs);
                  const parents = (parentsByChild.get(event.id) ?? [])
                    .map((parentId) => events.find((candidate) => candidate.id === parentId))
                    .filter((parent): parent is EventRow => parent !== undefined);
                  const parentLabel =
                    parents.length === 0
                      ? null
                      : `inside ${parents.map((parent) => parent.tagName).join(" and ")}`;

                  return (
                    <div
                      key={event.id}
                      className="absolute"
                      style={{
                        left: `${left}px`,
                        width: `${width}px`,
                        top: `${2 + bar.row * TRACK_ROW_HEIGHT_PX}px`,
                        height: `${TRACK_ROW_HEIGHT_PX - 4}px`,
                      }}
                    >
                      <button
                        type="button"
                        ref={
                          recording
                            ? (element) => {
                                if (element) liveBars.current.set(event.id, element);
                                else liveBars.current.delete(event.id);
                              }
                            : undefined
                        }
                        className={cn(
                          "absolute inset-0 overflow-hidden rounded-sm border border-black/20 text-left focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                          recording ? "cursor-pointer" : "cursor-grab",
                        )}
                        style={{
                          background: `linear-gradient(180deg, ${event.tagColor ?? track.colour ?? "var(--muted-foreground)"}d9 0%, ${event.tagColor ?? track.colour ?? "var(--muted-foreground)"}99 100%)`,
                        }}
                        // A bar too narrow for handles says so, rather than
                        // offering an edge that cannot be hit.
                        title={
                          recording
                            ? `${event.tagName} · recording — click to stop`
                            : isPhase
                              ? `${event.tagName} · ${phaseRun ? "phase" : "clip"} ${formatTimecode(shown.startMs)} → ${formatTimecode(shown.endMs)} (${formatDurationMs(phaseMs)}) · ${describeClosure(closure)}`
                              : `${event.tagName} · ${formatTimecode(shown.startMs)} → ${formatTimecode(shown.endMs)}${parentLabel === null ? "" : ` · ${parentLabel}`}${gripsFit ? "" : " — double-click to zoom in, then trim the ends"}`
                        }
                        aria-label={
                          isPhase
                            ? `${phaseLabel} from ${formatTimecode(shown.startMs)} to ${formatTimecode(shown.endMs)}, ${describeClosure(closure)}${parentLabel === null ? "" : `, ${parentLabel}`}`
                            : `${event.tagName} from ${formatTimecode(shown.startMs)} to ${formatTimecode(shown.endMs)}${parentLabel === null ? "" : `, ${parentLabel}`}`
                        }
                        onPointerDown={(pointerEvent) => {
                          // The growing bar belongs to the clock, so it is not a
                          // drag target: pressing it stops the passage, which is
                          // the one thing the user can mean by pressing it (D40).
                          if (recording) {
                            pointerEvent.stopPropagation();
                            const tag = tags.find((candidate) => candidate.id === event.tagId);
                            if (tag) void togglePhase(tag, playback.timeMs);
                            return;
                          }
                          beginBarDrag(pointerEvent, event);
                        }}
                        onDoubleClick={() => {
                          if (!recording) zoomToEvent(shown);
                        }}
                        onPointerEnter={() => setHovered(event.id)}
                        onPointerLeave={() =>
                          setHovered((current) => (current === event.id ? null : current))
                        }
                        onFocus={() => setHovered(event.id)}
                        onBlur={() =>
                          setHovered((current) => (current === event.id ? null : current))
                        }
                        onKeyDown={(keyEvent) => {
                          if (keyEvent.key !== "ArrowLeft" && keyEvent.key !== "ArrowRight") return;
                          keyEvent.preventDefault();
                          const step =
                            (keyEvent.shiftKey ? 5_000 : 1_000) *
                            (keyEvent.key === "ArrowLeft" ? -1 : 1);
                          void useEventStore.getState().setEventRange(event.id, {
                            startMs: shown.startMs + step,
                            endMs: shown.endMs + step,
                            anchorMs: shown.anchorMs + step,
                          });
                        }}
                      >
                        {/* The moment, marked inside its own padding: the clip is
                            pre-roll and post-roll around a tagged instant, and
                            without this the bar reads as a range that grew on
                            its own. Drawn only when there is room for it — on a
                            few pixels it would cover the whole bar. */}
                        {width >= 18 && (
                          <span
                            className="absolute top-0 bottom-0 w-0.5 rounded-sm bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
                            style={{ left: `${Math.min(Math.max(anchorX - 1, 0), width - 2)}px` }}
                            aria-hidden="true"
                          />
                        )}
                        {width > 56 && (
                          <span className="pointer-events-none absolute inset-0 truncate px-1 text-caption leading-none text-white/95">
                            {event.tagName}
                          </span>
                        )}
                      </button>

                      {/* An action's tick in its phase's colour, so the bar says
                          what it belongs to without a line across lanes (which
                          reads as noise). The link itself is `event_parents`; the
                          tooltip and the accessible name carry the phase's name. */}
                      {parents.length > 0 && (
                        <span
                          className="pointer-events-none absolute -top-px bottom-0 left-0 w-0.5 rounded-l-sm"
                          style={{ background: parents[0]?.tagColor ?? "var(--foreground)" }}
                          aria-hidden="true"
                        />
                      )}

                      {/* The trim handles. They exist only when the bar can hold
                          them, so a press is never ambiguous: the body moves, and
                          a handle trims. Rendered as a hairline rather than a
                          block, so a clip does not read as a pair of brackets. */}
                      {gripsFit &&
                        (["start", "end"] as const).map((side) => (
                          <button
                            key={side}
                            type="button"
                            aria-label={`Trim the ${side} of ${event.tagName} at ${formatTimecode(
                              side === "start" ? shown.startMs : shown.endMs,
                            )}`}
                            title={`Drag to trim the ${side} of this clip`}
                            className="group absolute top-0 bottom-0 cursor-col-resize focus-visible:outline-none"
                            style={
                              side === "start"
                                ? { left: 0, width: `${GRIP_PX}px` }
                                : { right: 0, width: `${GRIP_PX}px` }
                            }
                            onPointerDown={(pointerEvent) =>
                              beginBarTrim(pointerEvent, event, side, shown)
                            }
                          >
                            <span
                              className={cn(
                                "pointer-events-none absolute inset-y-1 left-1/2 w-px -translate-x-1/2 bg-white/60",
                                "group-hover:bg-white group-focus-visible:bg-white",
                              )}
                            />
                          </button>
                        ))}
                    </div>
                  );
                })}
              </section>
            </div>
          ))}

          {tracks.length === 0 && (
            <p className="px-2 py-3 text-label text-muted-foreground">
              {visible.length === 0 && events.length > 0
                ? "Every event is hidden by the filter above."
                : "No events yet — tag a moment and its track appears here."}
            </p>
          )}
        </div>

        {/* The playhead and the range selection cross every track, so they are
            drawn over the tracks rather than inside one lane, and outside the
            scroller so scrolling cannot move them. Both are placed in lane
            coordinates, which is why they carry the gutter offset. */}
        <div className="pointer-events-none absolute top-5 bottom-0 left-0 right-0">
          {selection && view && (
            <div
              className="absolute top-0 bottom-0 bg-primary/20"
              style={{
                left: `${GUTTER_PX + Math.min(timeToX(selection.startMs, view), timeToX(selection.endMs, view))}px`,
                width: `${Math.abs(timeToX(selection.endMs, view) - timeToX(selection.startMs, view))}px`,
              }}
            />
          )}
          <div
            ref={playheadRef}
            className="absolute top-0 bottom-0 w-px bg-primary"
            aria-hidden="true"
          />
        </div>

        {hoveredEvent && (
          <div
            className="pointer-events-none absolute bottom-full z-10 mb-1 w-40 overflow-hidden rounded-md border border-border bg-background shadow-lg"
            style={{
              left: `${GUTTER_PX + Math.max(0, timeToX(hoveredEvent.anchorMs, view ?? fitToDuration(1, 1)))}px`,
            }}
          >
            <span ref={hoverRef} className="block">
              {hoverThumbnail.status === "ready" ? (
                <img
                  src={hoverThumbnail.url}
                  alt=""
                  className="block aspect-video w-full object-cover"
                />
              ) : (
                <span className="flex aspect-video w-full items-center justify-center bg-muted text-caption text-muted-foreground">
                  no preview
                </span>
              )}
            </span>
            <span className="block truncate px-1.5 py-1 text-caption">
              {hoveredEvent.tagName} · {formatTimecode(hoveredEvent.anchorMs)}
            </span>
          </div>
        )}
      </div>

      {selection && <SelectionActions selection={selection} onDone={() => setSelection(null)} />}
    </div>
  );
}
