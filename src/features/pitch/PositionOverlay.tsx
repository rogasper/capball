import { type RefObject, useCallback, useMemo, useRef } from "react";
import { useContentRect } from "@/features/player/useContentRect";
import { derivePosition, homographyOf, regionOf } from "@/lib/pitch/positions";
import { useAnnotationStore } from "@/stores/annotationStore";
import { activeCalibrationAt, useCalibrationStore } from "@/stores/calibrationStore";
import { useEventStore } from "@/stores/eventStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { usePositionStore } from "@/stores/positionStore";
import { markerOffsets } from "./markers";

/**
 * Marking player positions on the frame (FR-30.3, FR-30.4).
 *
 * A click is turned into a pitch position by the pure functions in
 * `lib/pitch/positions.ts` and only reaches the store once it has been accepted,
 * so a point that falls off the pitch never becomes a row. A position the
 * calibration does not actually cover is stored but reported, because refusing it
 * outright would be wrong — the user can see the player — while presenting it as
 * exact would be dishonest (NFR-26).
 *
 * Markers sit where the click landed, not where the pitch coordinate projects
 * back: the click is the provenance, and a later calibration change must not
 * appear to move a position the user placed (FR-30.2).
 */

export function PositionOverlay({
  stageRef,
  videoRef,
}: {
  stageRef: RefObject<HTMLElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
}) {
  const rect = useContentRect(stageRef, videoRef);
  const surfaceRef = useRef<HTMLCanvasElement>(null);

  const probe = useLibraryStore((state) => state.probe);
  const frame = useMemo(
    () => ({ width: probe?.width ?? 0, height: probe?.height ?? 0 }),
    [probe?.width, probe?.height],
  );

  const marking = usePositionStore((state) => state.marking);
  const target = usePositionStore((state) => state.target);
  const positions = usePositionStore((state) => state.positions);

  const eventId = useAnnotationStore((state) => state.eventId);
  const events = useEventStore((state) => state.events);
  const calibrations = useCalibrationStore((state) => state.calibrations);
  const pitchLengthM = useCalibrationStore((state) => state.pitchLengthM);
  const pitchWidthM = useCalibrationStore((state) => state.pitchWidthM);

  const event = events.find((candidate) => candidate.id === eventId) ?? null;
  const calibration = event ? activeCalibrationAt(calibrations, event.anchorMs) : null;

  const onPointerDown = useCallback(
    async (pointerEvent: React.PointerEvent<HTMLCanvasElement>) => {
      if (!marking || !target) return;

      const store = usePositionStore.getState();

      if (!calibration || calibration.points.length < 4) {
        store.reportError("This video is not calibrated yet, so a click has no pitch position.");
        return;
      }
      if (frame.width <= 0 || frame.height <= 0) {
        store.reportError("The video's size is not known yet. Try again in a moment.");
        return;
      }

      // Read synchronously: a pointer event cannot be consulted later (see the
      // timeline fix — a state updater runs after dispatch has cleared it). The
      // surface is sized to the picture rect, so its own box is the frame.
      const box = pointerEvent.currentTarget.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return;
      const imageU = (pointerEvent.clientX - box.left) / box.width;
      const imageV = (pointerEvent.clientY - box.top) / box.height;

      const size = { lengthM: pitchLengthM, widthM: pitchWidthM };

      const solved = homographyOf(calibration.points, frame);
      if (!solved.ok) {
        store.reportError(solved.reason);
        return;
      }

      const verdict = derivePosition(
        solved.h,
        { imageU, imageV },
        frame,
        size,
        regionOf(calibration.points, size),
      );

      if (!verdict.ok) {
        store.reportError(verdict.reason);
        return;
      }

      await store.place({
        uid: crypto.randomUUID(),
        calibrationId: calibration.id,
        imageU,
        imageV,
        xM: verdict.xM,
        yM: verdict.yM,
      });
      store.reportNotice(verdict.warning);
    },
    [marking, target, calibration, frame, pitchLengthM, pitchWidthM],
  );

  if (positions.length === 0 && !marking) return null;

  return (
    <>
      {/* Existing markers, drawn where they were placed. */}
      <div
        className="pointer-events-none absolute"
        style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      >
        {markerOffsets(positions, rect).map(({ id, point }) => {
          const position = positions.find((candidate) => candidate.id === id);
          if (!position) return null;
          return (
            <span
              key={position.id}
              aria-hidden="true"
              title={`${position.shirtNumber ?? "?"} ${position.playerName} · ${position.teamName}`}
              className="absolute grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white text-[10px] font-semibold text-white shadow"
              style={{
                left: point[0],
                top: point[1],
                background: position.teamColor ?? "#111827",
              }}
            >
              {position.shirtNumber ?? "?"}
            </span>
          );
        })}
      </div>

      {/* The click surface, only while marking. A canvas like the other
          overlays, so the label sits on an element that can carry one. */}
      {marking && (
        <canvas
          ref={surfaceRef}
          aria-label="Mark player positions"
          className="absolute touch-none cursor-crosshair"
          style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
          onPointerDown={(pointerEvent) => {
            void onPointerDown(pointerEvent);
          }}
        />
      )}
    </>
  );
}
