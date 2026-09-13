import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useContentRect } from "@/features/player/useContentRect";
import { placeOnPitch } from "@/lib/pitch/place";
import { isPositionVisibleAt } from "@/lib/pitch/positions";
import { playback } from "@/lib/playback";
import { useAnnotationStore } from "@/stores/annotationStore";
import { activeCalibrationAt, useCalibrationStore } from "@/stores/calibrationStore";
import { useEventStore } from "@/stores/eventStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { usePositionStore } from "@/stores/positionStore";
import { markerOffsets, normaliseFromBox } from "./markers";

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
 *
 * They are shown while the playhead is inside the event's own range and hidden
 * outside it, because the click only tells the truth at that moment. The rule is
 * read through `playback.onFrame` — which fires on seek and on load as well as
 * during playback — and only touches state when the answer flips, so nothing here
 * re-renders per frame.
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

  // The event's own range is the display window. Seeded from the controller
  // directly, because a selection that does not move the playhead emits no frame
  // — and re-seeded whenever the range or the marking mode changes.
  const range = useMemo(
    () => (event ? { startMs: event.startMs, endMs: event.endMs } : null),
    [event],
  );
  const [visible, setVisible] = useState(() =>
    isPositionVisibleAt(playback.timeMs, range, marking),
  );

  useEffect(() => {
    const decide = (atMs: number) => isPositionVisibleAt(atMs, range, marking);
    setVisible(decide(playback.timeMs));
    return playback.onFrame((atMs) =>
      setVisible((current) => {
        const next = decide(atMs);
        return current === next ? current : next;
      }),
    );
  }, [range, marking]);

  const onPointerDown = useCallback(
    async (pointerEvent: React.PointerEvent<HTMLCanvasElement>) => {
      if (!marking || !target) return;

      const store = usePositionStore.getState();

      if (frame.width <= 0 || frame.height <= 0) {
        store.reportError("The video's size is not known yet. Try again in a moment.");
        return;
      }

      // Read synchronously: a pointer event cannot be consulted later (see the
      // timeline fix — a state updater runs after dispatch has cleared it). The
      // surface is sized to the picture rect, so its own box is the frame.
      const point = normaliseFromBox(
        pointerEvent.currentTarget.getBoundingClientRect(),
        pointerEvent.clientX,
        pointerEvent.clientY,
      );
      if (!point) return;
      const [imageU, imageV] = point;

      const verdict = placeOnPitch({
        calibration,
        click: { imageU, imageV },
        frame,
        size: { lengthM: pitchLengthM, widthM: pitchWidthM },
      });

      if (!verdict.ok) {
        store.reportError(verdict.reason);
        return;
      }

      await store.place({
        uid: crypto.randomUUID(),
        calibrationId: calibration?.id ?? null,
        imageU,
        imageV,
        xM: verdict.xM,
        yM: verdict.yM,
      });
      store.reportNotice(verdict.warning);
    },
    [marking, target, calibration, frame, pitchLengthM, pitchWidthM],
  );

  // Outside the event's range there is nothing honest to draw: the player has
  // moved. Marking keeps it visible, because placing a point needs its context.
  if (!visible || (positions.length === 0 && !marking)) return null;

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
