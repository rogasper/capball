import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { buildEventDraft } from "@/features/tagging/captureContext";
import { ON_DEMAND, useThumbnail } from "@/lib/media/thumbnails";
import { playback } from "@/lib/playback";
import { formatTimecode } from "@/lib/time/timecode";
import { cn } from "@/lib/utils";
import { applyFilters, useEventStore } from "@/stores/eventStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { usePlayerStore } from "@/stores/playerStore";
import { useTagStore } from "@/stores/tagStore";
import { FilterBar } from "./FilterBar";
import {
  fitToDuration,
  followPlayhead,
  layoutMarkers,
  layoutTicks,
  panBy,
  timeToX,
  type Viewport,
  xToTime,
  zoomAt,
} from "./scale";

const LANE_HEIGHT_PX = 46;
const ZOOM_STEP = 1.6;

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

export function Timeline() {
  const events = useEventStore((state) => state.events);
  const filters = useEventStore((state) => state.filters);

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
    const element = laneRef.current;
    if (!element) return;

    const update = () => setWidthPx(element.clientWidth);
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

  // The playhead is driven from the playback controller, never from state, and
  // the view only moves when the playhead would otherwise leave it.
  useEffect(
    () =>
      playback.onFrame((timeMs) => {
        const current = viewRef.current;
        if (!current) return;

        const x = timeToX(timeMs, current);
        const element = playheadRef.current;
        if (element) {
          element.style.opacity = x >= -1 && x <= current.widthPx + 1 ? "1" : "0";
          element.style.transform = `translateX(${x}px)`;
        }

        const followed = followPlayhead(current, timeMs);
        if (followed !== current) setView(followed);
      }),
    [],
  );

  const zoomBy = useCallback((factor: number) => {
    setView((current) => (current ? zoomAt(current, factor, current.widthPx / 2) : current));
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
  const markers = useMemo(() => (view ? layoutMarkers(visible, view, 5) : []), [visible, view]);

  const hoveredEvent = visible.find((event) => event.id === hovered) ?? null;
  const { state: hoverThumbnail, ref: hoverRef } = useThumbnail(
    sourcePath,
    hoveredEvent?.anchorMs ?? 0,
    ON_DEMAND,
  );

  const drag = useRef<{ mode: "pan" | "select"; originX: number; originView: Viewport } | null>(
    null,
  );
  const moved = useRef(false);

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
    const lane = laneRef.current;
    if (!lane) return 0;
    return clientX - lane.getBoundingClientRect().left;
  };

  const beginPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!view) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { mode: "pan", originX: event.clientX, originView: view };
    moved.current = false;
  };

  const beginSelect = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!view) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { mode: "select", originX: event.clientX, originView: view };
    moved.current = false;

    const timeMs = xToTime(localX(event.clientX), view);
    setSelection({ startMs: timeMs, endMs: timeMs });
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;

    const deltaX = event.clientX - state.originX;
    if (Math.abs(deltaX) > 2) moved.current = true;

    if (state.mode === "pan") {
      setView(panBy(state.originView, -deltaX));
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

    // A press that never moved is a seek, not a drag.
    if (!moved.current) {
      const timeMs = xToTime(localX(event.clientX), state.originView);
      playback.seekMs(timeMs);
      if (state.mode === "select") setSelection(null);
    }
  };

  const laneTone = "border-border bg-background";

  return (
    <div className="space-y-2 border-t border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {durationMs > 0 ? (
          <FilterBar />
        ) : (
          <span className="text-label text-muted-foreground">Add a video to see the timeline</span>
        )}

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

      <div
        ref={laneRef}
        className="relative select-none touch-none"
        title="Drag to select a range, click to seek, scroll to pan, ⌘/Ctrl-scroll to zoom"
      >
        {/* Ruler: drag to pan, click to seek. Clipped so a label can never
            escape the lane, whatever the tick layout decides. */}
        <div
          className={cn("relative h-5 cursor-grab overflow-hidden border-b", laneTone)}
          onPointerDown={beginPan}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          role="slider"
          aria-label="Timeline"
          aria-valuemin={0}
          aria-valuemax={Math.round(durationMs)}
          aria-valuenow={Math.round(view ? view.viewStartMs : 0)}
          tabIndex={0}
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

        {/* Marker lane: drag to select, click to seek. */}
        <div
          className={cn("relative overflow-hidden", laneTone)}
          style={{ height: LANE_HEIGHT_PX }}
          onPointerDown={beginSelect}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
        >
          {selection && view && (
            <div
              className="absolute top-0 bottom-0 bg-primary/20"
              style={{
                left: `${Math.min(
                  timeToX(selection.startMs, view),
                  timeToX(selection.endMs, view),
                )}px`,
                width: `${Math.abs(
                  timeToX(selection.endMs, view) - timeToX(selection.startMs, view),
                )}px`,
              }}
            />
          )}

          {markers.map((marker) => {
            if (marker.kind === "cluster") {
              return (
                <span
                  key={`cluster-${marker.x}`}
                  className="absolute bottom-1 w-1.5 rounded-sm bg-muted-foreground/70"
                  style={{
                    left: `${marker.x}px`,
                    top: marker.eventIds.length > 8 ? "4px" : "10px",
                  }}
                  title={`${marker.eventIds.length} events here`}
                />
              );
            }

            const event = visible.find((candidate) => candidate.id === marker.eventId);
            if (!event) return null;

            return (
              <button
                key={event.id}
                type="button"
                className="absolute top-1 bottom-1 w-1.5 rounded-sm focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                style={{
                  left: `${marker.x}px`,
                  background: event.tagColor ?? "var(--muted-foreground)",
                }}
                title={`${event.tagName} · ${formatTimecode(event.anchorMs)}`}
                aria-label={`${event.tagName} at ${formatTimecode(event.anchorMs)}`}
                onPointerDown={(pointerEvent) => pointerEvent.stopPropagation()}
                onPointerEnter={() => setHovered(event.id)}
                onPointerLeave={() =>
                  setHovered((current) => (current === event.id ? null : current))
                }
                onFocus={() => setHovered(event.id)}
                onBlur={() => setHovered((current) => (current === event.id ? null : current))}
                onClick={() => playback.seekMs(event.anchorMs)}
              />
            );
          })}

          {/* The playhead: positioned imperatively, never through React state. */}
          <div
            ref={playheadRef}
            className="pointer-events-none absolute top-0 bottom-0 left-0 w-px bg-primary"
            aria-hidden="true"
          />

          {hoveredEvent && (
            <div
              className="pointer-events-none absolute bottom-full z-10 mb-1 w-40 overflow-hidden rounded-md border border-border bg-background shadow-lg"
              style={{
                left: `${Math.max(0, timeToX(hoveredEvent.anchorMs, view ?? fitToDuration(1, 1)))}px`,
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
                    {hoverThumbnail.status === "failed" ? "No preview" : "…"}
                  </span>
                )}
              </span>
              <span className="block truncate px-1.5 py-1 text-caption">
                {hoveredEvent.tagName} · {formatTimecode(hoveredEvent.anchorMs)}
              </span>
            </div>
          )}
        </div>
      </div>

      {selection && <SelectionActions selection={selection} onDone={() => setSelection(null)} />}
    </div>
  );
}
