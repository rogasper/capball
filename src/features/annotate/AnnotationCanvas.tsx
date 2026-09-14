import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useContentRect } from "@/features/player/useContentRect";
import {
  boxGeometry,
  type Handle,
  type HandleName,
  handlesFor,
  hitTest,
  MIN_SIZE,
  midpointIndexOf,
  normalizePoint,
  type Point,
  pathGeometry,
  type Rect,
  twoPointGeometry,
  vertexIndexOf,
} from "@/lib/annotate/geometry";
import { toPrimitive, visibleAnnotations } from "@/lib/annotate/primitives";
import type { Annotation, ShapeKind } from "@/lib/annotate/types";
import { spaceOf } from "@/lib/annotate/types";
import { handleLabel, removableVertexFor } from "@/lib/annotate/vertices";
import { resolveWindow, type WindowContext } from "@/lib/annotate/window";
import { homographyOf, regionOf } from "@/lib/pitch/positions";
import { pitchShapeAt, projectShapes } from "@/lib/pitch/shapePrimitives";
import { playback } from "@/lib/playback";
import { type Canvas2D, renderPrimitives } from "@/lib/render/canvas";
import { useAnnotationStore } from "@/stores/annotationStore";
import { activeCalibrationAt, useCalibrationStore } from "@/stores/calibrationStore";
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
/** Add-a-corner grips are smaller and hollow, so they read as secondary. */
const ADD_HANDLE_SIZE_PX = 6;
/** Freehand points closer together than this are not worth keeping. */
const FREEHAND_STEP = 0.0015;

type Drag =
  | { mode: "move"; last: Point }
  | { mode: "resize"; handle: HandleName }
  /** One vertex of a polygon, line or arrow (FR-20.11). */
  | { mode: "vertex"; index: number }
  | { mode: "rotate" }
  | { mode: "shape"; start: Point; startPx: Point; kind: ShapeKind }
  | { mode: "freehand" };

export function AnnotationCanvas({
  stageRef,
  videoRef,
  /** False while another layer, such as calibration, is taking the clicks. */
  interactive = true,
}: {
  stageRef: RefObject<HTMLElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  interactive?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rect = useContentRect(stageRef, videoRef);
  const dragRef = useRef<Drag | null>(null);
  const freehandRef = useRef<Point[]>([]);
  const [handles, setHandles] = useState<Handle[]>([]);
  const playbackUrl = useLibraryStore((state) => state.playbackUrl);
  const paused = usePlayerStore((state) => state.paused);
  const eventId = useAnnotationStore((state) => state.eventId);
  const annotations = useAnnotationStore((state) => state.annotations);
  const selectedId = useAnnotationStore((state) => state.selectedId);
  const armed = useAnnotationStore((state) => state.tool);
  const toolSurface = useAnnotationStore((state) => state.toolSurface);
  /**
   * The tool as *this* surface sees it. The pitch view arms its own tools, and a
   * tool armed there must not capture the video's pointer — that is what made the
   * app look locked while a zone was being drawn on the pitch (FR-80.4).
   */
  const tool = toolSurface === "frame" ? armed : null;
  const draft = useAnnotationStore((state) => state.draft);
  const draftPoints = useAnnotationStore((state) => state.draftPoints);
  const style = useAnnotationStore((state) => state.style);
  const events = useEventStore((state) => state.events);

  const selectedEvent = events.find((event) => event.id === eventId) ?? null;
  const selected = annotations.find((annotation) => annotation.id === selectedId);

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

  /**
   * The frame the canvas covers, so its own origin is the picture's origin.
   * Memoised on the size: a new object every render would restart every effect
   * that depends on it.
   */
  const frame = useMemo<Rect>(() => ({ x: 0, y: 0, w: rect.w, h: rect.h }), [rect.w, rect.h]);

  /**
   * The pitch-anchored shapes on this frame, projected (FR-80.2).
   *
   * A pitch shape is stored in metres, so it can only reach the picture through
   * the calibration that applies to this event. Without one nothing is drawn and
   * the pitch panel says why — the canvas never invents a placement.
   */
  const probe = useLibraryStore((state) => state.probe);
  const calibrations = useCalibrationStore((state) => state.calibrations);
  const pitchLengthM = useCalibrationStore((state) => state.pitchLengthM);
  const pitchWidthM = useCalibrationStore((state) => state.pitchWidthM);

  const projection = useMemo(() => {
    const videoSize = { width: probe?.width ?? 0, height: probe?.height ?? 0 };
    const calibration = selectedEvent
      ? activeCalibrationAt(calibrations, selectedEvent.anchorMs)
      : null;
    if (!calibration || videoSize.width <= 0 || videoSize.height <= 0) {
      return { h: null, region: null, videoSize };
    }
    const size = { lengthM: pitchLengthM, widthM: pitchWidthM };
    const solved = homographyOf(calibration.points, videoSize);
    return {
      h: solved.ok ? solved.h : null,
      region: regionOf(calibration.points, size),
      videoSize,
    };
  }, [calibrations, selectedEvent, probe?.width, probe?.height, pitchLengthM, pitchWidthM]);

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

    // The bitmap has to be whole pixels while the CSS box may not be, so the
    // transform is derived from both: using the device ratio alone would squash
    // the drawing by the rounding error and leave the pitch lines a fraction off
    // the points they are meant to pass through.
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(frame.w * ratio));
    const height = Math.max(1, Math.round(frame.h * ratio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    // jsdom returns null here, which is why the drawing itself is tested
    // through `renderPrimitives` with a recording context.
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(width / frame.w, 0, 0, height / frame.h, 0, 0);
    ctx.clearRect(0, 0, frame.w, frame.h);

    const context = windowContext();
    const visible = visibleAnnotations(annotations, playback.timeMs, context);
    const frameShapes = visible.filter((annotation) => spaceOf(annotation.geometry) === "frame");
    const pitchShapes = visible.filter((annotation) => spaceOf(annotation.geometry) === "pitch");

    // Both spaces reach the picture through the one renderer, so a pitch shape
    // and a frame shape cannot disagree about paint order or about pixels.
    const primitives = [
      ...frameShapes.map(toPrimitive),
      ...projectShapes(pitchShapes, projection.h, projection.videoSize, projection.region)
        .primitives,
    ].sort((a, b) => a.z - b.z || a.annotationId - b.annotationId);

    const pending = draftAnnotation();
    if (pending && spaceOf(pending.geometry) === "frame") primitives.push(toPrimitive(pending));

    // The renderer only ever assigns string styles, so the narrower structural
    // type is accurate; it is what makes the drawing assertable in a test.
    renderPrimitives(primitives, ctx as unknown as Canvas2D, frame.w, frame.h);
  }, [annotations, draftAnnotation, frame, projection, windowContext]);

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
    // A pitch-anchored shape has no grips here: its numbers are metres, and a
    // handle drag in frame pixels would be nonsense. It is edited on the pitch
    // view, where its geometry is the view's own coordinate space (FR-80.3).
    const editable = selected && spaceOf(selected.geometry) === "frame" ? selected : null;
    setHandles(editable ? handlesFor(editable, frame) : []);
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
    // Both spaces can be drawn in; this surface draws on the frame, and saying
    // so here is what keeps the space out of a global setting (FR-80.4).
    store.setDraftSpace("frame");

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
    const candidate = annotations.find((annotation) => annotation.id === selectedId);
    // A pitch-anchored shape is visible here but not editable here: its grips
    // live on the pitch view, where a pixel means a metre (FR-80.3).
    const selected = candidate && spaceOf(candidate.geometry) === "frame" ? candidate : undefined;

    if (selected) {
      // The add-a-corner grips are clicks, not drags, so they are not part of
      // the drag search; a press near one falls through to the shape under it.
      const grip = handlesFor(selected, frame)
        .filter((handle) => midpointIndexOf(handle.name) === null)
        .find(
          (handle) => Math.hypot(handle.point[0] - px[0], handle.point[1] - px[1]) <= HANDLE_HIT_PX,
        );
      if (grip) {
        const vertex = vertexIndexOf(grip.name);
        store.beginDrag();
        dragRef.current =
          vertex !== null
            ? { mode: "vertex", index: vertex }
            : grip.name === "rotate"
              ? { mode: "rotate" }
              : { mode: "resize", handle: grip.name };
        return;
      }
    }

    // Topmost first: the last painted shape is the one the user sees. Only
    // frame-anchored shapes are tested, because a hit test compares the pointer
    // with the shape's own numbers and a pitch shape's numbers are metres.
    const ordered = annotations
      .filter((annotation) => spaceOf(annotation.geometry) === "frame")
      .sort((a, b) => b.z - a.z || b.id - a.id);
    const hit = ordered.find((annotation) => hitTest(annotation, px, frame, 6));

    if (!hit) {
      // A pitch-anchored shape is visible here but its numbers are metres, so it
      // cannot be hit-tested against frame pixels — it is tested against the
      // shape it *projects to*. Clicking it selects it and points at the surface
      // where it can be moved, rather than doing nothing.
      const pitched = annotations.filter((annotation) => spaceOf(annotation.geometry) === "pitch");
      const onPitch = pitchShapeAt(
        projectShapes(pitched, projection.h, projection.videoSize, projection.region),
        px,
        frame,
        8,
      );

      if (onPitch !== null) {
        store.select(onPitch);
        store.reportNotice(
          "That shape is anchored to the pitch. Move, reshape or delete it in the Pitch tab, where its numbers are metres.",
        );
        dragRef.current = null;
        return;
      }

      store.select(null);
      dragRef.current = null;
      return;
    }

    store.select(hit.id);
    store.beginDrag();
    dragRef.current = { mode: "move", last: normalizePoint(frame, px[0], px[1]) };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive || rect.w <= 0 || !selectedEvent) return;
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
      case "vertex":
        store.moveVertexTo(drag.index, px, frame);
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
    // Add-a-corner grips are clicks; leaving pointerdown unhandled keeps them
    // from starting a drag that would move the shape instead of editing it.
    if (midpointIndexOf(handle.name) !== null) return;

    const vertex = vertexIndexOf(handle.name);
    const store = useAnnotationStore.getState();
    store.beginDrag();
    dragRef.current =
      vertex !== null
        ? { mode: "vertex", index: vertex }
        : handle.name === "rotate"
          ? { mode: "rotate" }
          : { mode: "resize", handle: handle.name };
    canvasRef.current?.setPointerCapture(event.pointerId);
  };

  const onRemoveVertex = (index: number) => (event: React.SyntheticEvent) => {
    // A focused corner owns Delete: without stopping the event, the window's
    // shortcut would delete the whole shape instead of one of its corners.
    event.preventDefault();
    event.stopPropagation();
    void useAnnotationStore.getState().removeVertexAt(index);
  };

  const onVertexKeyDown = (index: number) => (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Delete" || event.key === "Backspace") onRemoveVertex(index)(event);
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
          pointerEvents: interactive ? undefined : "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      />

      {interactive && tool === null && handles.length > 0 && (
        <div className="pointer-events-none absolute" style={{ left: rect.x, top: rect.y }}>
          {handles.map((handle) => {
            const addIndex = midpointIndexOf(handle.name);
            const removeIndex = removableVertexFor(handle.name, selected);
            const label = handleLabel(handle.name, selected);
            const size = addIndex !== null ? ADD_HANDLE_SIZE_PX : HANDLE_SIZE_PX;

            return (
              <button
                key={handle.name}
                type="button"
                aria-label={label}
                title={label}
                className={`pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full border ${
                  addIndex !== null
                    ? "border-dashed border-primary/70 bg-background"
                    : "border-white bg-primary"
                }`}
                style={{
                  left: handle.point[0],
                  top: handle.point[1],
                  width: size,
                  height: size,
                }}
                onPointerDown={onHandleDown(handle)}
                onClick={
                  addIndex === null
                    ? undefined
                    : (event) => {
                        event.stopPropagation();
                        void useAnnotationStore.getState().insertVertexAfter(addIndex);
                      }
                }
                onDoubleClick={removeIndex === null ? undefined : onRemoveVertex(removeIndex)}
                onKeyDown={removeIndex === null ? undefined : onVertexKeyDown(removeIndex)}
              />
            );
          })}
        </div>
      )}
    </>
  );
}
