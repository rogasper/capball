import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  boxGeometry,
  contentRect,
  type Handle,
  type HandleName,
  handlesFor,
  hitTest,
  MIN_SIZE,
  normalizePoint,
  type Point,
  pathGeometry,
  type Rect,
  twoPointGeometry,
} from "@/lib/annotate/geometry";
import { toPrimitive, toPrimitives } from "@/lib/annotate/primitives";
import type { Annotation, ShapeKind } from "@/lib/annotate/types";
import { resolveWindow, type WindowContext } from "@/lib/annotate/window";
import { playback } from "@/lib/playback";
import { type Canvas2D, renderPrimitives } from "@/lib/render/canvas";
import { useAnnotationStore } from "@/stores/annotationStore";
import { useEventStore } from "@/stores/eventStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { usePlayerStore } from "@/stores/playerStore";

/**
 * The drawing surface (plans/technical-design-R1.md §5.2).
 *
 * One canvas, drawn by the same `renderPrimitives` the burn-in will call. It is
 * placed over the video's **content rect**, so a stored normalised coordinate
 * lands on the same picture the user drew on at any window size.
 *
 * Handles are DOM rather than paint: they are UI, so they can never leak into
 * an exported clip.
 */

const HANDLE_HIT_PX = 11;
/** A drag shorter than this is a click, not a shape. */
const MIN_DRAG_PX = 4;
const HANDLE_SIZE_PX = 9;
/** Freehand points closer together than this are not worth keeping. */
const FREEHAND_STEP = 0.0015;

export const HANDLE_LABELS: Record<HandleName, string> = {
  nw: "Resize from top left",
  ne: "Resize from top right",
  se: "Resize from bottom right",
  sw: "Resize from bottom left",
  p0: "Move start point",
  p1: "Move end point",
  rotate: "Rotate",
};

type Drag =
  | { mode: "move"; last: Point }
  | { mode: "resize"; handle: HandleName }
  | { mode: "rotate" }
  | { mode: "shape"; start: Point; startPx: Point; kind: ShapeKind }
  | { mode: "freehand" };

export function AnnotationCanvas({
  stageRef,
  videoRef,
}: {
  stageRef: RefObject<HTMLElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const dragRef = useRef<Drag | null>(null);
  const freehandRef = useRef<Point[]>([]);
  const [handles, setHandles] = useState<Handle[]>([]);

  const playbackUrl = useLibraryStore((state) => state.playbackUrl);
  const paused = usePlayerStore((state) => state.paused);
  const eventId = useAnnotationStore((state) => state.eventId);
  const annotations = useAnnotationStore((state) => state.annotations);
  const selectedId = useAnnotationStore((state) => state.selectedId);
  const tool = useAnnotationStore((state) => state.tool);
  const draft = useAnnotationStore((state) => state.draft);
  const draftPoints = useAnnotationStore((state) => state.draftPoints);
  const style = useAnnotationStore((state) => state.style);
  const events = useEventStore((state) => state.events);

  const selectedEvent = events.find((event) => event.id === eventId) ?? null;

  /** Everything a time window needs, read at the moment of drawing. */
  const windowContext = useCallback(
    (): WindowContext => ({
      anchorMs: selectedEvent?.anchorMs ?? 0,
      eventStartMs: selectedEvent?.startMs ?? 0,
      eventEndMs: selectedEvent?.endMs ?? 0,
      durationMs: playback.durationMs || useLibraryStore.getState().probe?.durationMs || 0,
    }),
    [selectedEvent],
  );

  // The picture's rect inside the stage: the canvas is placed exactly on it.
  useEffect(() => {
    const stage = stageRef.current;
    const video = videoRef.current;
    if (!stage || !video) return;

    const measure = () => {
      const next = contentRect(
        stage.clientWidth,
        stage.clientHeight,
        video.videoWidth,
        video.videoHeight,
      );
      setRect((prev) =>
        prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h
          ? prev
          : next,
      );
    };

    measure();
    video.addEventListener("loadedmetadata", measure);
    video.addEventListener("resize", measure);

    // jsdom has no ResizeObserver; the canvas only matters in a real window.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(stage);

    return () => {
      observer?.disconnect();
      video.removeEventListener("loadedmetadata", measure);
      video.removeEventListener("resize", measure);
    };
    // `playbackUrl` deliberately absent: a new source fires `loadedmetadata`,
    // which is what re-measures.
  }, [stageRef, videoRef]);

  /**
   * The frame the canvas covers, so its own origin is the picture's origin.
   * Memoised on the size: a new object every render would restart every effect
   * that depends on it.
   */
  const frame = useMemo<Rect>(() => ({ x: 0, y: 0, w: rect.w, h: rect.h }), [rect.w, rect.h]);

  const draftAnnotation = useCallback((): Annotation | null => {
    if (tool === null) return null;

    const common = {
      id: -1,
      uid: "draft",
      eventId: eventId ?? 0,
      windowMode: "moment" as const,
      windowMs: 0,
      style,
      label: tool === "text" ? "" : null,
      z: Number.MAX_SAFE_INTEGER,
    };

    if (tool === "freehand") {
      if (freehandRef.current.length < 2) return null;
      return { ...common, kind: "freehand", geometry: pathGeometry(freehandRef.current) };
    }
    if (tool === "polygon") {
      if (!draftPoints || draftPoints.length < 2) return null;
      return { ...common, kind: "polygon", geometry: pathGeometry(draftPoints) };
    }
    if (draft) return { ...common, kind: tool, geometry: draft };
    return null;
  }, [draft, draftPoints, eventId, style, tool]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || frame.w <= 0 || frame.h <= 0) return;

    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(frame.w * ratio));
    const height = Math.max(1, Math.round(frame.h * ratio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    // jsdom returns null here, which is why the drawing itself is tested
    // through `renderPrimitives` with a recording context.
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, frame.w, frame.h);

    const primitives = toPrimitives(annotations, playback.timeMs, windowContext());
    const pending = draftAnnotation();
    if (pending) primitives.push(toPrimitive(pending));

    // The renderer only ever assigns string styles, so the narrower structural
    // type is accurate; it is what makes the drawing assertable in a test.
    renderPrimitives(primitives, ctx as unknown as Canvas2D, frame.w, frame.h);
  }, [annotations, draftAnnotation, frame, windowContext]);

  useEffect(() => {
    draw();
  }, [draw]);

  // While playing, redraw only when a shape's window opens or closes — not on
  // every frame (the repaint budget in NFR-21).
  useEffect(() => {
    let lastVisible: string | null = null;
    return playback.onFrame(() => {
      const atMs = playback.timeMs;
      const context = windowContext();
      const visible = annotations
        .filter((annotation) => {
          const { startMs, endMs } = resolveWindow(annotation, context);
          return atMs >= startMs && atMs <= endMs;
        })
        .map((annotation) => annotation.id)
        .join(",");
      if (visible === lastVisible) return;
      lastVisible = visible;
      draw();
    });
  }, [annotations, draw, windowContext]);

  useEffect(() => {
    const selected = annotations.find((annotation) => annotation.id === selectedId);
    setHandles(selected ? handlesFor(selected, frame) : []);
  }, [annotations, selectedId, frame]);

  /** Pointer position in canvas pixels, always measured against the canvas. */
  const pointOf = (event: { clientX: number; clientY: number }): Point => {
    const box = canvasRef.current?.getBoundingClientRect();
    if (!box) return [0, 0];
    return [event.clientX - box.left, event.clientY - box.top];
  };

  const startDrawing = (px: Point) => {
    if (tool === null) return;
    const store = useAnnotationStore.getState();
    const point = normalizePoint(frame, px[0], px[1]);

    if (tool === "freehand") {
      freehandRef.current = [point];
      dragRef.current = { mode: "freehand" };
      return;
    }

    if (tool === "polygon") {
      // A vertex per click; Enter or a double click closes the zone.
      store.updateDraftPoints([...(draftPoints ?? []), point]);
      return;
    }

    if (tool === "text") {
      store.beginDraft({ x: point[0], y: point[1], w: 0, h: 0, rotation: 0 });
      void store.commitDraft();
      return;
    }

    dragRef.current = { mode: "shape", start: point, startPx: px, kind: tool };
    store.beginDraft(
      tool === "arrow" || tool === "line"
        ? twoPointGeometry(point, point)
        : boxGeometry(point, point),
    );
  };

  const startSelecting = (px: Point) => {
    const store = useAnnotationStore.getState();
    const selected = annotations.find((annotation) => annotation.id === selectedId);

    if (selected) {
      const grip = handlesFor(selected, frame).find(
        (handle) => Math.hypot(handle.point[0] - px[0], handle.point[1] - px[1]) <= HANDLE_HIT_PX,
      );
      if (grip) {
        store.beginDrag();
        dragRef.current =
          grip.name === "rotate" ? { mode: "rotate" } : { mode: "resize", handle: grip.name };
        return;
      }
    }

    // Topmost first: the last painted shape is the one the user sees.
    const ordered = [...annotations].sort((a, b) => b.z - a.z || b.id - a.id);
    const hit = ordered.find((annotation) => hitTest(annotation, px, frame, 6));

    if (!hit) {
      store.select(null);
      dragRef.current = null;
      return;
    }

    store.select(hit.id);
    store.beginDrag();
    dragRef.current = { mode: "move", last: normalizePoint(frame, px[0], px[1]) };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (rect.w <= 0 || !selectedEvent) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const px = pointOf(event);

    if (tool !== null) {
      // OQ-3: a drawing belongs to a frozen frame, so playing means no drawing.
      if (paused) startDrawing(px);
      return;
    }

    startSelecting(px);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || rect.w <= 0) return;

    const px = pointOf(event);
    const point = normalizePoint(frame, px[0], px[1]);
    const store = useAnnotationStore.getState();

    switch (drag.mode) {
      case "move":
        store.moveSelected([point[0] - drag.last[0], point[1] - drag.last[1]]);
        drag.last = point;
        break;
      case "resize":
        store.resizeSelected(drag.handle, px, frame);
        break;
      case "rotate":
        store.rotateSelected(px, frame);
        break;
      case "shape":
        store.updateDraft(
          drag.kind === "arrow" || drag.kind === "line"
            ? twoPointGeometry(drag.start, point)
            : boxGeometry(drag.start, point),
        );
        break;
      case "freehand": {
        const last = freehandRef.current.at(-1);
        if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < FREEHAND_STEP) break;
        freehandRef.current = [...freehandRef.current, point];
        store.updateDraftPoints(freehandRef.current);
        break;
      }
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const store = useAnnotationStore.getState();

    if (drag.mode === "shape") {
      const px = pointOf(event);
      const moved = Math.hypot(px[0] - drag.startPx[0], px[1] - drag.startPx[1]);
      const current = store.draft;
      const degenerate =
        (drag.kind === "rect" || drag.kind === "ellipse") &&
        current !== null &&
        (current.w < MIN_SIZE || current.h < MIN_SIZE);

      if (moved < MIN_DRAG_PX || degenerate) store.cancelDraft();
      else void store.commitDraft();
      return;
    }

    if (drag.mode === "freehand") {
      if (freehandRef.current.length < 2) store.cancelDraft();
      else void store.commitDraft();
      freehandRef.current = [];
      return;
    }

    void store.commitGeometry();
  };

  const onDoubleClick = () => {
    if (tool === "polygon" && (draftPoints?.length ?? 0) >= 3) {
      void useAnnotationStore.getState().commitDraft();
    }
  };

  /** A handle press captures the pointer on the canvas, which owns the drag. */
  const onHandleDown = (handle: Handle) => (event: React.PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const store = useAnnotationStore.getState();
    store.beginDrag();
    dragRef.current =
      handle.name === "rotate" ? { mode: "rotate" } : { mode: "resize", handle: handle.name };
    canvasRef.current?.setPointerCapture(event.pointerId);
  };

  if (!playbackUrl || !selectedEvent) return null;

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-label="Annotation layer"
        className="absolute touch-none"
        style={{
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
          cursor: tool ? "crosshair" : "default",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      />

      {tool === null && handles.length > 0 && (
        <div className="pointer-events-none absolute" style={{ left: rect.x, top: rect.y }}>
          {handles.map((handle) => (
            <button
              key={handle.name}
              type="button"
              aria-label={HANDLE_LABELS[handle.name]}
              className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-primary shadow"
              style={{
                left: handle.point[0],
                top: handle.point[1],
                width: HANDLE_SIZE_PX,
                height: HANDLE_SIZE_PX,
              }}
              onPointerDown={onHandleDown(handle)}
            />
          ))}
        </div>
      )}
    </>
  );
}
