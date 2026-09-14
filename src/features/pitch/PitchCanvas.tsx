import { ArrowRight, Circle, Minus, MousePointer2, Pentagon, Square } from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  boxGeometry,
  type HandleName,
  handlesFor,
  hitTest,
  midpointIndexOf,
  normalizePoint,
  type Point,
  pathGeometry,
  type Rect,
  twoPointGeometry,
  vertexIndexOf,
} from "@/lib/annotate/geometry";
import type { ShapeKind } from "@/lib/annotate/types";
import { type Annotation, spaceOf } from "@/lib/annotate/types";
import { handleLabel, removableVertexFor } from "@/lib/annotate/vertices";
import type { PitchSize } from "@/lib/pitch/pitchModel";
import { pitchRectOf, screenToPitch, viewBoxOf } from "@/lib/pitch/pitchView";
import { homographyOf, regionOf } from "@/lib/pitch/positions";
import { projectShapes } from "@/lib/pitch/shapePrimitives";
import { useAnnotationStore } from "@/stores/annotationStore";
import { activeCalibrationAt, useCalibrationStore } from "@/stores/calibrationStore";
import { useEventStore } from "@/stores/eventStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { Pitch3D } from "./Pitch3D";
import { PitchView, type PitchViewSet } from "./PitchView";

/**
 * Drawing on the pitch (FR-80.2, FR-80.3).
 *
 * The pitch view is the surface where a shape's own coordinates *are* the
 * view's, so a zone is drawn in metres and projected into the camera's
 * perspective afterwards. That is the whole point of the second geometry space:
 * a shape drawn here is correct from any angle the calibration covers, and it
 * follows the calibration when a better one is made.
 *
 * Two rules differ from the frame canvas, deliberately:
 *
 * - **The video need not be paused.** A frame drawing belongs to a frozen
 *   moment (R1's OQ-3) because it covers pixels that move; a pitch shape belongs
 *   to the event, and the pitch does not move.
 * - **Freehand and text are not offered.** A stroke in metres has no meaning to
 *   an analyst, and text on a plane in perspective would have to be faked. Both
 *   stay frame-only, and the panel says so instead of leaving a dead control.
 */

/** A shape smaller than this in metres is a click, not a drawing. */
const MIN_PITCH_SIZE_M = 0.2;
/** A pointer that moved fewer client pixels than this did not draw a shape. */
const MIN_DRAG_PX = 4;

const TOOLS: { kind: ShapeKind; label: string; Icon: typeof Square }[] = [
  { kind: "arrow", label: "Arrow, in metres", Icon: ArrowRight },
  { kind: "line", label: "Line, in metres", Icon: Minus },
  { kind: "rect", label: "Rectangle, in metres", Icon: Square },
  { kind: "ellipse", label: "Ellipse, in metres", Icon: Circle },
  { kind: "polygon", label: "Zone by clicks, in metres", Icon: Pentagon },
];

function sameBox(a: DOMRect, b: DOMRect): boolean {
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

type Drag =
  /** Drawing a new shape, in metres. */
  | { mode: "shape"; start: Point; startClient: Point; kind: ShapeKind }
  /** Moving a selected shape: `last` is in metres. */
  | { mode: "move"; last: Point }
  | { mode: "resize"; handle: HandleName }
  | { mode: "rotate"; handle: "rotate" }
  | { mode: "vertex"; index: number };

/** How close a pointer has to be to a grip to take hold of it, in pixels. */
const HANDLE_HIT_PX = 11;

export function PitchCanvas({
  size,
  sets,
  emptyMessage,
}: {
  size: PitchSize;
  sets: PitchViewSet[];
  emptyMessage: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  /**
   * Which renderer draws this diagram.
   *
   * The tools, the gestures and the captions are the surface's; only the drawing
   * of the pitch changes, which is the point of keeping one pitch-space model and
   * two renderers (D34/D36). Reshaping a corner stays top-down, because a grip
   * drag needs a linear pixel-to-metre mapping.
   */
  const [view, setView] = useState<"top" | "angled">("top");
  const dragRef = useRef<Drag | null>(null);

  const eventId = useAnnotationStore((state) => state.eventId);
  const annotations = useAnnotationStore((state) => state.annotations);
  const armed = useAnnotationStore((state) => state.tool);
  const toolSurface = useAnnotationStore((state) => state.toolSurface);
  /**
   * The tool as *this* surface sees it.
   *
   * The two drawing surfaces have separate spaces, so each owns its own armed
   * tool: a tool picked here leaves the video's canvas free to select and play,
   * and one picked there leaves this diagram free to browse (FR-80.4).
   */
  const tool = toolSurface === "pitch" ? armed : null;
  const draftPoints = useAnnotationStore((state) => state.draftPoints);
  const selectedId = useAnnotationStore((state) => state.selectedId);
  const probe = useLibraryStore((state) => state.probe);
  const events = useEventStore((state) => state.events);
  const calibrations = useCalibrationStore((state) => state.calibrations);
  const pitchLengthM = useCalibrationStore((state) => state.pitchLengthM);
  const pitchWidthM = useCalibrationStore((state) => state.pitchWidthM);

  const event = events.find((candidate) => candidate.id === eventId) ?? null;
  const calibration = event ? activeCalibrationAt(calibrations, event.anchorMs) : null;
  const videoSize = useMemo(
    () => ({ width: probe?.width ?? 0, height: probe?.height ?? 0 }),
    [probe?.width, probe?.height],
  );

  /** The pitch-anchored shapes of this moment: the only ones drawn here. */
  const shapes = useMemo(
    () => annotations.filter((annotation) => spaceOf(annotation.geometry) === "pitch"),
    [annotations],
  );

  /**
   * The drawings of this moment that live on the video frame instead.
   *
   * They are not drawn here — their numbers are fractions of the picture — and
   * without saying so the pitch view looks like it lost them, while the Draw tab
   * still lists them. A visible drawing that is absent from a view must be
   * explained, not left to be discovered.
   */
  const frameDrawings = useMemo(
    () => annotations.filter((annotation) => spaceOf(annotation.geometry) === "frame").length,
    [annotations],
  );

  /**
   * How much of what was drawn can honestly be placed on the video.
   *
   * Computed with the same function the frame canvas draws with, so the numbers
   * in this caption and the shapes on the video cannot disagree.
   */
  const summary = useMemo(() => {
    const solved = calibration ? homographyOf(calibration.points, videoSize) : null;
    const region = calibration
      ? regionOf(calibration.points, { lengthM: pitchLengthM, widthM: pitchWidthM })
      : null;
    return projectShapes(shapes, solved?.ok ? solved.h : null, videoSize, region);
  }, [shapes, calibration, videoSize, pitchLengthM, pitchWidthM]);

  /**
   * The SVG's box and this wrapper's, so a metre can be turned into a pixel of
   * the handle layer. Measured rather than derived: the diagram's size comes from
   * the panel it sits in.
   */
  const [boxes, setBoxes] = useState<{ svg: DOMRect; wrap: DOMRect } | null>(null);
  /**
   * Measured after every render, and only stored when it moved.
   *
   * No dependency list on purpose: the things that shift this diagram are the
   * captions above and below it, which come and go with the tool, the selection
   * and the projection, so any list would be a guess. Reading two rects is cheap
   * and the equality check is what stops it looping.
   */
  useLayoutEffect(() => {
    const svg = svgRef.current;
    const wrap = wrapRef.current;
    if (!svg || !wrap) return;
    const next = { svg: svg.getBoundingClientRect(), wrap: wrap.getBoundingClientRect() };
    setBoxes((previous) =>
      previous && sameBox(previous.svg, next.svg) && sameBox(previous.wrap, next.wrap)
        ? previous
        : next,
    );
  });

  const pitchRect = useMemo<Rect | null>(() => {
    if (!boxes) return null;
    return pitchRectOf(
      {
        left: boxes.svg.left - boxes.wrap.left,
        top: boxes.svg.top - boxes.wrap.top,
        width: boxes.svg.width,
        height: boxes.svg.height,
      },
      viewBoxOf(size),
    );
  }, [boxes, size]);

  const selected = useMemo(
    () => shapes.find((annotation) => annotation.id === selectedId),
    [shapes, selectedId],
  );

  /**
   * The shape being drawn, as the view needs it to show it live.
   *
   * A pitch draft is *only* ever previewed here — the frame canvas refuses to
   * preview it, because its numbers are metres and that surface draws in
   * fractions.
   */
  const draftGeometry = useAnnotationStore((state) => state.draft);
  const style = useAnnotationStore((state) => state.style);
  const draftShape = useMemo<Annotation | null>(() => {
    if (tool === null) return null;

    const common = {
      id: -1,
      uid: "draft",
      eventId: eventId ?? 0,
      windowMode: "moment" as const,
      windowMs: 0,
      style,
      label: null,
      z: Number.MAX_SAFE_INTEGER,
    };

    if (tool === "polygon") {
      if (!draftPoints || draftPoints.length < 2) return null;
      return {
        ...common,
        kind: "polygon",
        geometry: { ...pathGeometry(draftPoints), space: "pitch" },
      };
    }
    if (!draftGeometry) return null;
    return { ...common, kind: tool, geometry: { ...draftGeometry, space: "pitch" } };
  }, [draftGeometry, draftPoints, eventId, style, tool]);

  const pointOf = useCallback(
    (event: { clientX: number; clientY: number }): Point | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      return screenToPitch(
        event.clientX,
        event.clientY,
        svg.getBoundingClientRect(),
        viewBoxOf(size),
      );
    },
    [size],
  );

  const onPointerDown = (pointerEvent: React.PointerEvent<HTMLDivElement>) => {
    if (tool === null) {
      startManipulating(pointerEvent);
      return;
    }
    const store = useAnnotationStore.getState();

    // The surface declares the space: this one draws in metres (FR-80.4).
    store.setDraftSpace("pitch");

    if (tool === "freehand" || tool === "text") {
      store.reportError(
        "Freehand and text are drawn on the video frame. The pitch view draws zones, lines, arrows and ellipses.",
      );
      return;
    }

    const point = pointOf(pointerEvent);
    if (!point) return;

    if (tool === "polygon") {
      // A vertex per click; Enter or a double click closes the zone.
      store.updateDraftPoints([...(draftPoints ?? []), point]);
      return;
    }

    pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
    dragRef.current = {
      mode: "shape",
      start: point,
      startClient: [pointerEvent.clientX, pointerEvent.clientY],
      kind: tool,
    };
    store.beginDraft(
      tool === "arrow" || tool === "line"
        ? twoPointGeometry(point, point)
        : boxGeometry(point, point),
    );
  };

  /** The pointer in the handle layer's pixels — the space `pitchRect` maps. */
  const localPointOf = useCallback(
    (pointerEvent: { clientX: number; clientY: number }): Point | null =>
      boxes
        ? [pointerEvent.clientX - boxes.wrap.left, pointerEvent.clientY - boxes.wrap.top]
        : null,
    [boxes],
  );

  /**
   * A press with no tool in hand: take hold of a grip, else of a shape.
   *
   * Everything below is M12's toolkit pointed at the pitch. It works because
   * `pitchRect` presents a metre as if it were a pixel of a rect — the same shape
   * of mapping the frame canvas hands the same functions.
   */
  const startManipulating = (pointerEvent: React.PointerEvent<HTMLDivElement>) => {
    const store = useAnnotationStore.getState();
    const local = localPointOf(pointerEvent);
    if (!pitchRect || !local) return;

    if (selected) {
      const grip = handlesFor(selected, pitchRect)
        .filter((handle) => midpointIndexOf(handle.name) === null)
        .find(
          (handle) =>
            Math.hypot(handle.point[0] - local[0], handle.point[1] - local[1]) <= HANDLE_HIT_PX,
        );
      if (grip) {
        const vertex = vertexIndexOf(grip.name);
        store.beginDrag();
        dragRef.current =
          vertex !== null
            ? { mode: "vertex", index: vertex }
            : grip.name === "rotate"
              ? { mode: "rotate", handle: "rotate" }
              : { mode: "resize", handle: grip.name };
        pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
        return;
      }
    }

    // Topmost first: the last painted shape is the one the user sees.
    const ordered = [...shapes].sort((a, b) => b.z - a.z || b.id - a.id);
    const hit = ordered.find((annotation) => hitTest(annotation, local, pitchRect, 8));
    if (!hit) {
      store.select(null);
      dragRef.current = null;
      return;
    }

    store.select(hit.id);
    store.beginDrag();
    dragRef.current = { mode: "move", last: normalizePoint(pitchRect, local[0], local[1]) };
    pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
  };

  const onPointerMove = (pointerEvent: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const store = useAnnotationStore.getState();

    if (drag.mode === "shape") {
      const point = pointOf(pointerEvent);
      if (!point) return;
      store.updateDraft(
        drag.kind === "arrow" || drag.kind === "line"
          ? twoPointGeometry(drag.start, point)
          : boxGeometry(drag.start, point),
      );
      return;
    }

    const local = localPointOf(pointerEvent);
    if (!local || !pitchRect) return;

    switch (drag.mode) {
      case "move": {
        const metres = normalizePoint(pitchRect, local[0], local[1]);
        store.moveSelected([metres[0] - drag.last[0], metres[1] - drag.last[1]]);
        drag.last = metres;
        break;
      }
      case "resize":
        store.resizeSelected(drag.handle, local, pitchRect);
        break;
      case "rotate":
        store.rotateSelected(local, pitchRect);
        break;
      case "vertex":
        store.moveVertexTo(drag.index, local, pitchRect);
        break;
    }
  };

  const onPointerUp = (pointerEvent: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (pointerEvent.currentTarget.hasPointerCapture(pointerEvent.pointerId)) {
      pointerEvent.currentTarget.releasePointerCapture(pointerEvent.pointerId);
    }

    const store = useAnnotationStore.getState();

    // A manipulation is persisted by the same gesture-scoped write M12 uses.
    if (drag.mode !== "shape") {
      void store.commitGeometry();
      return;
    }

    const moved = Math.hypot(
      pointerEvent.clientX - drag.startClient[0],
      pointerEvent.clientY - drag.startClient[1],
    );
    const current = store.draft;
    const tooSmall =
      (drag.kind === "rect" || drag.kind === "ellipse") &&
      current !== null &&
      (current.w < MIN_PITCH_SIZE_M || current.h < MIN_PITCH_SIZE_M);

    if (moved < MIN_DRAG_PX || tooSmall) {
      store.cancelDraft();
      return;
    }

    // One shape, then the diagram goes back to selecting: a tool that stays armed
    // is a tool that swallows the next click, which is exactly how the video came
    // to feel locked after a zone was drawn here.
    void store.commitDraft().finally(() => {
      if (useAnnotationStore.getState().draft === null) {
        useAnnotationStore.getState().setTool(null);
      }
    });
  };

  const onDoubleClick = () => {
    if (tool === "polygon" && (draftPoints?.length ?? 0) >= 3) {
      void useAnnotationStore.getState().commitDraft();
    }
  };

  if (event === null) {
    return (
      <p className="text-body text-muted-foreground">
        Select a tagged moment to see its shape on the pitch.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <Button
          variant={view === "top" ? "default" : "outline"}
          size="xs"
          aria-pressed={view === "top"}
          onClick={() => setView("top")}
        >
          Top-down
        </Button>
        <Button
          variant={view === "angled" ? "default" : "outline"}
          size="xs"
          aria-pressed={view === "angled"}
          onClick={() => setView("angled")}
        >
          Angled
        </Button>
      </div>

      {frameDrawings > 0 && (
        <p className="rounded-md border border-border bg-muted px-2 py-1.5 text-caption text-muted-foreground">
          {frameDrawings === 1
            ? "One drawing on this moment is anchored to the video frame, so it is drawn over the video, not here"
            : `${frameDrawings} drawings on this moment are anchored to the video frame, so they are drawn over the video, not here`}
          — edit {frameDrawings === 1 ? "it" : "them"} in the Draw tab. Only shapes drawn on the
          pitch appear on this diagram.
        </p>
      )}

      {calibration === null ? (
        <p className="rounded-md border border-border bg-muted px-2 py-1.5 text-label text-muted-foreground">
          Drawing on the pitch needs the perspective first: calibrate this video above, and shapes
          will be stored in metres and projected onto the frame.
        </p>
      ) : (
        <>
          <div className="space-y-1.5">
            <p className="text-label text-muted-foreground">
              Draw on the pitch — shapes are stored in metres
            </p>
            <div className="flex flex-wrap gap-1">
              <Button
                variant={tool === null ? "default" : "outline"}
                size="icon-sm"
                aria-label="Select on the pitch"
                aria-pressed={tool === null}
                onClick={() => useAnnotationStore.getState().setTool(null)}
              >
                <MousePointer2 aria-hidden="true" />
              </Button>
              {TOOLS.map(({ kind, label, Icon }) => (
                <Button
                  key={kind}
                  variant={tool === kind ? "default" : "outline"}
                  size="icon-sm"
                  aria-label={label}
                  aria-pressed={tool === kind}
                  onClick={() =>
                    useAnnotationStore.getState().setTool(tool === kind ? null : kind, "pitch")
                  }
                >
                  <Icon aria-hidden="true" />
                </Button>
              ))}
            </div>
          </div>

          <p className="text-caption text-muted-foreground">
            A shape drawn here belongs to the pitch, so it appears over the video in the camera's
            perspective and moves if you correct the calibration. A shape drawn on the frame keeps
            its pixels and never moves. Click a shape to select it and drag to move it; the corner
            grips reshape it, and Delete removes the focused corner or the whole shape. After each
            new shape the diagram goes back to selecting, so no tool stays armed by accident.
          </p>

          {tool === "polygon" && (
            <p className="text-label text-muted-foreground">
              {draftPoints && draftPoints.length > 0
                ? `${draftPoints.length} point${draftPoints.length === 1 ? "" : "s"} — press Enter or double-click to close the zone.`
                : "Click each corner of the zone on the pitch, then press Enter or double-click to close it."}
            </p>
          )}

          {(summary.guessedIds.length > 0 || summary.omitted.length > 0) && (
            <p className="text-caption text-warning">
              {summary.guessedIds.length > 0 &&
                `${summary.guessedIds.length} ${summary.guessedIds.length === 1 ? "shape reaches" : "shapes reach"} outside the area your calibration covers, so ${summary.guessedIds.length === 1 ? "its" : "their"} position on the video is a guide rather than a measurement. `}
              {summary.omitted.length > 0 &&
                `${summary.omitted.length} ${summary.omitted.length === 1 ? "shape is" : "shapes are"} not drawn over the video at all, because nothing about ${summary.omitted.length === 1 ? "it" : "them"} is inside that area.`}
            </p>
          )}
        </>
      )}

      {view === "angled" ? (
        <Pitch3D size={size} positions={sets[0]?.positions ?? []} emptyMessage={emptyMessage} />
      ) : (
        // biome-ignore lint/a11y/noStaticElementInteractions: the handlers only turn pointer positions into metres; the labelled surface is the SVG inside, and every shape is listed and editable in the Layers panel.
        <div
          ref={wrapRef}
          className={
            tool !== null && tool !== "text" && tool !== "freehand"
              ? "relative cursor-crosshair"
              : "relative"
          }
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
        >
          <PitchView
            size={size}
            sets={sets}
            shapes={shapes}
            draft={draftShape}
            draftPoints={draftPoints ?? []}
            emptyMessage={emptyMessage}
            svgRef={svgRef}
            drawing={tool !== null}
          />

          {/* The grips are DOM, like the frame canvas's, so they can never end up
            in an exported clip. They sit at the same metre-to-pixel positions the
            drags compute from, because both use `pitchRect`. */}
          {tool === null && selected && pitchRect && (
            <div className="pointer-events-none absolute inset-0">
              {handlesFor(selected, pitchRect).map((handle) => {
                const addIndex = midpointIndexOf(handle.name);
                const removeIndex = removableVertexFor(handle.name, selected);
                const label = handleLabel(handle.name, selected);
                const gripSize = addIndex !== null ? 6 : 9;

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
                      width: gripSize,
                      height: gripSize,
                    }}
                    onPointerDown={(gripEvent) => {
                      gripEvent.stopPropagation();
                      if (addIndex !== null) return;
                      const vertex = vertexIndexOf(handle.name);
                      const store = useAnnotationStore.getState();
                      store.beginDrag();
                      dragRef.current =
                        vertex !== null
                          ? { mode: "vertex", index: vertex }
                          : handle.name === "rotate"
                            ? { mode: "rotate", handle: "rotate" }
                            : { mode: "resize", handle: handle.name };
                      wrapRef.current?.setPointerCapture(gripEvent.pointerId);
                    }}
                    onClick={
                      addIndex === null
                        ? undefined
                        : (clickEvent) => {
                            clickEvent.stopPropagation();
                            void useAnnotationStore.getState().insertVertexAfter(addIndex);
                          }
                    }
                    onDoubleClick={
                      removeIndex === null
                        ? undefined
                        : (doubleEvent) => {
                            doubleEvent.preventDefault();
                            doubleEvent.stopPropagation();
                            void useAnnotationStore.getState().removeVertexAt(removeIndex);
                          }
                    }
                    onKeyDown={
                      removeIndex === null
                        ? undefined
                        : (keyEvent) => {
                            if (keyEvent.key !== "Delete" && keyEvent.key !== "Backspace") return;
                            keyEvent.preventDefault();
                            keyEvent.stopPropagation();
                            void useAnnotationStore.getState().removeVertexAt(removeIndex);
                          }
                    }
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
