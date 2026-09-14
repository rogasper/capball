import { useEffect, useMemo, useRef, useState } from "react";
import { Color, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from "three";
import { Button } from "@/components/ui/button";
import { boxGeometry, type Point, pathGeometry, twoPointGeometry } from "@/lib/annotate/geometry";
import { type Annotation, spaceOf } from "@/lib/annotate/types";
import type { PositionRow } from "@/lib/db/queries/positions";
import { cameraPosesFor, groundPointFromNdc, metresPerPixel, poseById } from "@/lib/pitch/pitch3d";
import type { PitchSize } from "@/lib/pitch/pitchModel";
import { pitchShapeAtPoint } from "@/lib/pitch/shapePrimitives";
import { buildPitchGroup, disposeGroup, type SceneMarker } from "@/lib/pitch/threeScene";
import { useAnnotationStore } from "@/stores/annotationStore";
import { markerLabel, NEUTRAL_TEAM_COLOUR } from "./markers";

/**
 * The angled pitch view (FR-80.1, FR-80.2).
 *
 * A second camera on the same flat plane. Nothing here invents a height: the
 * scene is the pitch model and the recorded shapes, laid on `y = 0`, and a marker
 * is a label floating above its position rather than a body. Drawing works
 * because a ray through a screen pixel meets that plane in exactly one place —
 * the mathematics is `pitch3d.ts`, checked against three's own raycaster, and T10
 * measured what a click is worth at each pose (0.27 m per pixel at worst, so a
 * sloppy three-pixel click stays inside a metre).
 *
 * What is deliberately **not** here: reshaping a corner. A grip drag needs a
 * pixel-to-metre mapping that is linear, which a perspective divide is not; the
 * top-down view is where a shape is reshaped, and this one is for seeing and
 * placing. Moving a shape works, because a drag is two ground points and their
 * difference is exact.
 */

const PIXEL_TOLERANCE = 8;

type Drag =
  | { mode: "shape"; start: Point; startClient: Point; kind: Annotation["kind"] }
  | { mode: "move"; last: Point };

export function Pitch3D({
  size,
  positions,
  emptyMessage,
}: {
  size: PitchSize;
  positions: PositionRow[];
  emptyMessage: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [poseId, setPoseId] = useState("broadcast");
  /** Set when the machine has no WebGL, so the panel can say why it is missing. */
  const [unavailable, setUnavailable] = useState(false);

  const annotations = useAnnotationStore((state) => state.annotations);
  const tool = useAnnotationStore((state) => state.tool);
  const toolSurface = useAnnotationStore((state) => state.toolSurface);
  const armed = toolSurface === "pitch" ? tool : null;
  const draftGeometry = useAnnotationStore((state) => state.draft);
  const draftPoints = useAnnotationStore((state) => state.draftPoints);
  const style = useAnnotationStore((state) => state.style);
  const eventId = useAnnotationStore((state) => state.eventId);
  const selectedId = useAnnotationStore((state) => state.selectedId);

  const shapes = useMemo(
    () => annotations.filter((annotation) => spaceOf(annotation.geometry) === "pitch"),
    [annotations],
  );

  const markers = useMemo<SceneMarker[]>(
    () =>
      positions.map((position) => ({
        xM: position.xM,
        yM: position.yM,
        label: markerLabel(position),
        color: position.teamColor ?? NEUTRAL_TEAM_COLOUR,
      })),
    [positions],
  );

  const draft = useMemo<Annotation | null>(() => {
    if (armed === null || armed === "freehand" || armed === "text") return null;
    const geometry =
      armed === "polygon"
        ? draftPoints && draftPoints.length >= 2
          ? pathGeometry(draftPoints)
          : null
        : draftGeometry;
    if (!geometry) return null;
    return {
      id: -1,
      uid: "draft",
      eventId: eventId ?? 0,
      kind: armed,
      windowMode: "moment",
      windowMs: 0,
      geometry: { ...geometry, space: "pitch" },
      style,
      label: null,
      z: Number.MAX_SAFE_INTEGER,
    };
  }, [armed, draftGeometry, draftPoints, eventId, style]);

  /**
   * The renderer, one per mount.
   *
   * Kept in a ref and driven imperatively: the scene is rebuilt when the shapes,
   * markers or pose change, and the old one is disposed, because a WebGL surface
   * that leaks a geometry per redraw is a warm laptop after an hour of video.
   */
  const rendererRef = useRef<WebGLRenderer | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true });
    } catch {
      // A machine without WebGL gets the top-down view and a note, not a crash.
      setUnavailable(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = SRGBColorSpace;
    rendererRef.current = renderer;

    const scene = new Scene();
    scene.background = new Color("#0b1220");
    const camera = new PerspectiveCamera(40, 16 / 9, 1, 400);
    const group = buildPitchGroup({
      size,
      markers,
      annotations: [...shapes, ...(draft ? [draft] : [])],
    });
    scene.add(group);

    const pose = poseById(poseId);
    camera.position.set(pose.eye[0], pose.eye[1], pose.eye[2]);
    camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
    camera.fov = pose.fovDeg;
    camera.aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    camera.updateProjectionMatrix();

    const resize = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width <= 0 || height <= 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };

    resize();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => resize());
    observer?.observe(canvas);

    return () => {
      observer?.disconnect();
      disposeGroup(scene);
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [size, markers, shapes, draft, poseId]);

  /** A screen point as pitch metres, through the current pose. */
  const pointOf = (event: { clientX: number; clientY: number }): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const box = canvas.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;

    const ndc = {
      x: ((event.clientX - box.left) / box.width) * 2 - 1,
      y: -(((event.clientY - box.top) / box.height) * 2 - 1),
    };
    return groundPointFromNdc(poseById(poseId), ndc, box.width / box.height);
  };

  /** How many metres a pixel is worth where the pointer is, for a fair tolerance. */
  const toleranceAt = (point: Point, pixels = PIXEL_TOLERANCE): number => {
    const canvas = canvasRef.current;
    const measured = metresPerPixel(
      poseById(poseId),
      point,
      canvas ? canvas.clientWidth / Math.max(1, canvas.clientHeight) : 16 / 9,
      canvas?.clientWidth || 960,
    );
    return (measured ?? 0.5) * pixels;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = pointOf(event);
    if (!point) return;
    const store = useAnnotationStore.getState();

    if (armed !== null) {
      store.setDraftSpace("pitch");
      if (armed === "polygon") {
        store.updateDraftPoints([...(draftPoints ?? []), point]);
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        mode: "shape",
        start: point,
        startClient: [event.clientX, event.clientY],
        kind: armed,
      };
      store.beginDraft(
        armed === "arrow" || armed === "line"
          ? twoPointGeometry(point, point)
          : boxGeometry(point, point),
      );
      return;
    }

    const hit = pitchShapeAtPoint(shapes, point, toleranceAt(point));
    if (hit === null) {
      store.select(null);
      return;
    }

    store.select(hit);
    store.beginDrag();
    dragRef.current = { mode: "move", last: point };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const point = pointOf(event);
    if (!point) return;
    const store = useAnnotationStore.getState();

    if (drag.mode === "shape") {
      store.updateDraft(
        drag.kind === "arrow" || drag.kind === "line"
          ? twoPointGeometry(drag.start, point)
          : boxGeometry(drag.start, point),
      );
      return;
    }

    // Two ground points: their difference is exact however steep the view is.
    store.moveSelected([point[0] - drag.last[0], point[1] - drag.last[1]]);
    drag.last = point;
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const store = useAnnotationStore.getState();
    if (drag.mode === "move") {
      void store.commitGeometry();
      return;
    }

    const moved = Math.hypot(
      event.clientX - drag.startClient[0],
      event.clientY - drag.startClient[1],
    );
    const current = store.draft;
    if (moved < 4 || (current !== null && current.w < 0.2 && current.h < 0.2)) {
      store.cancelDraft();
      return;
    }

    // One shape, then back to selecting — the same rule the top-down view uses.
    void store.commitDraft().finally(() => {
      if (useAnnotationStore.getState().draft === null) {
        useAnnotationStore.getState().setTool(null);
      }
    });
  };

  const onDoubleClick = () => {
    if (armed !== "polygon") return;
    if ((draftPoints?.length ?? 0) < 3) return;
    void useAnnotationStore
      .getState()
      .commitDraft()
      .finally(() => useAnnotationStore.getState().setTool(null));
  };

  const poses = useMemo(() => cameraPosesFor(size, 16 / 9), [size]);

  if (unavailable) {
    return (
      <p className="rounded-md border border-border bg-muted px-2 py-1.5 text-label text-muted-foreground">
        This machine cannot draw an angled view (no WebGL), so the top-down pitch is the one to use.
        Nothing else about the pitch is affected.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        {poses.map((pose) => (
          <Button
            key={pose.id}
            variant={pose.id === poseId ? "default" : "outline"}
            size="xs"
            aria-pressed={pose.id === poseId}
            onClick={() => setPoseId(pose.id)}
          >
            {pose.label}
          </Button>
        ))}
      </div>

      <canvas
        ref={canvasRef}
        aria-label={`Angled pitch view with ${positions.length} marked ${
          positions.length === 1 ? "position" : "positions"
        }${shapes.length > 0 ? ` and ${shapes.length} drawn ${shapes.length === 1 ? "shape" : "shapes"}` : ""}`}
        className={`w-full touch-none rounded-md ${armed !== null ? "cursor-crosshair" : ""}`}
        style={{ aspectRatio: "16 / 9" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      />

      {positions.length === 0 && shapes.length === 0 && (
        <p className="text-body text-muted-foreground">{emptyMessage}</p>
      )}

      <p className="text-caption text-muted-foreground">
        The same pitch from an angle — no height is invented, and a marker is a label over its
        position, not a body. Drawing works here: a click lands on the ground exactly where the ray
        meets it (measured at about a quarter of a metre per pixel at worst, so a sloppy click stays
        inside a metre). Reshaping a corner is done in the top-down view
        {selectedId !== null && shapes.some((shape) => shape.id === selectedId)
          ? "; this shape can be dragged here."
          : "."}
      </p>
    </div>
  );
}
