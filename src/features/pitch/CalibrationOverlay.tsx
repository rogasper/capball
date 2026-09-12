import { type RefObject, useCallback, useEffect, useMemo, useRef } from "react";
import { useContentRect } from "@/features/player/useContentRect";
import { normalizePoint, type Point, type Rect } from "@/lib/annotate/geometry";
import type { Primitive } from "@/lib/annotate/primitives";
import { outlinePrimitives } from "@/lib/pitch/project";
import { type Canvas2D, renderPrimitives } from "@/lib/render/canvas";
import { solvePicks, useCalibrationStore } from "@/stores/calibrationStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { pickMarkers } from "./markers";

/**
 * The verification overlay (FR-30.2).
 *
 * While reference points are being picked, the pitch outline the calibration
 * implies is drawn over the frame. A point picked on the wrong feature makes the
 * outline visibly wrong immediately, which is the whole reason this exists: a
 * calibration that is off by one touchline is otherwise invisible until a
 * position is placed and looks wrong much later.
 *
 * The outline is projected into primitives in normalised frame coordinates and
 * drawn by the same renderer as the annotations, so the two can never disagree
 * about where something lies on the frame.
 */

const OUTLINE_STROKE = "#22D3EE";

export function CalibrationOverlay({
  stageRef,
  videoRef,
}: {
  stageRef: RefObject<HTMLElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rect = useContentRect(stageRef, videoRef);

  const videoId = useCalibrationStore((state) => state.videoId);
  const picks = useCalibrationStore((state) => state.picks);
  const pendingFeature = useCalibrationStore((state) => state.pendingFeature);
  const addPick = useCalibrationStore((state) => state.addPick);

  const probe = useLibraryStore((state) => state.probe);
  const frame = useMemo(
    () => ({ width: probe?.width ?? 0, height: probe?.height ?? 0 }),
    [probe?.width, probe?.height],
  );

  const frameRect: Rect = { x: 0, y: 0, w: rect.w, h: rect.h };

  /** Picking needs a usable frame size; without it there is no pixel space. */
  const solvable = frame.width > 0 && frame.height > 0;
  const outcome = useMemo(
    () => (solvable ? solvePicks(picks, frame) : null),
    [picks, frame, solvable],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || rect.w <= 0 || rect.h <= 0) return;

    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.w * ratio));
    const height = Math.max(1, Math.round(rect.h * ratio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, rect.w, rect.h);

    if (!outcome?.ok || frame.width <= 0) return;

    const primitives: Primitive[] = outlinePrimitives(
      outcome.h,
      {
        lengthM: useCalibrationStore.getState().pitchLengthM,
        widthM: useCalibrationStore.getState().pitchWidthM,
      },
      frame,
      { stroke: OUTLINE_STROKE, width: 0.0022, opacity: 0.9 },
    );

    renderPrimitives(primitives, ctx as unknown as Canvas2D, rect.w, rect.h);
  }, [outcome, frame, rect.h, rect.w]);

  useEffect(() => {
    draw();
  }, [draw]);

  const picking = pendingFeature !== null;

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!picking || rect.w <= 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    const px: Point = [event.clientX - box.left, event.clientY - box.top];
    const [imageU, imageV] = normalizePoint(frameRect, px[0], px[1]);
    void addPick(imageU, imageV);
  };

  if (videoId === null) return null;

  const markers = pickMarkers(picks, rect);

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-label="Calibration outline"
        className="absolute touch-none"
        style={{
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
          cursor: picking ? "crosshair" : "default",
          pointerEvents: picking ? "auto" : "none",
        }}
        onPointerDown={onPointerDown}
      />

      {/* Markers are DOM, so they can never be mistaken for part of the picture.
          This box carries the picture's offset; `pickMarkers` returns positions
          inside it. Adding the offset in both places is the double offset that
          put every marker a letterbox away from its click. */}
      <div
        className="pointer-events-none absolute"
        style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      >
        {markers.map((marker, index) => (
          <span
            key={marker.feature}
            aria-hidden="true"
            title={marker.feature}
            className="absolute grid size-4 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white bg-cyan-400 text-[9px] font-medium text-black"
            style={{ left: marker.point[0], top: marker.point[1] }}
          >
            {index + 1}
          </span>
        ))}
      </div>
    </>
  );
}
