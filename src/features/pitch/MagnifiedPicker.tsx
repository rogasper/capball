import { Minus, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Primitive } from "@/lib/annotate/primitives";
import { ipc } from "@/lib/ipc";
import { findFeature } from "@/lib/pitch/pitchModel";
import { placeOnPitch } from "@/lib/pitch/place";
import { describeCoverage, isNarrowCoverage, regionOf } from "@/lib/pitch/positions";
import { outlinePrimitives } from "@/lib/pitch/project";
import { playback } from "@/lib/playback";
import { type Canvas2D, renderPrimitives } from "@/lib/render/canvas";
import { cn } from "@/lib/utils";
import { useAnnotationStore } from "@/stores/annotationStore";
import { activeCalibrationAt, solvePicks, useCalibrationStore } from "@/stores/calibrationStore";
import { useEventStore } from "@/stores/eventStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { type MagnifierMode, useMagnifierStore } from "@/stores/magnifierStore";
import { usePositionStore } from "@/stores/positionStore";
import { normaliseFromBox, pickMarkers } from "./markers";

/**
 * Placing points on the frame, at a size that can be clicked accurately
 * (FR-30.2, FR-30.3).
 *
 * Measured reason this exists: the video is displayed at roughly 430 CSS px for
 * a 1920-px picture, so one screen pixel is 4.45 video pixels. Clicking "within
 * three pixels" on the video is therefore a 13-pixel error on the frame, which
 * the outline shows as a visible mismatch. The fix is not to move the numbers, it
 * is to click on a bigger picture — and the same penalty applies to a player's
 * position, so one magnified view serves both flows.
 *
 * The frame is extracted from the file at full resolution, so this does not
 * depend on the window layout either. The outline, the markers and the click all
 * live in this canvas's own box, so they cannot disagree with each other.
 */

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

export function MagnifiedPicker({ mode }: { mode: MagnifierMode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<string | null>(null);

  const [framePath, setFramePath] = useState<string | null>(null);
  const [frameError, setFrameError] = useState<string | null>(null);
  /** The decoded frame. Held in state so a redraw happens when it arrives. */
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(2);
  // The moment is captured when the view opens: the frame on screen is the one
  // being calibrated, and it must not move because the playhead did.
  const [atMs] = useState(() => Math.max(0, Math.round(playback.timeMs)));

  const picks = useCalibrationStore((state) => state.picks);
  const pendingFeature = useCalibrationStore((state) => state.pendingFeature);
  const calibrations = useCalibrationStore((state) => state.calibrations);
  const pitchLengthM = useCalibrationStore((state) => state.pitchLengthM);
  const pitchWidthM = useCalibrationStore((state) => state.pitchWidthM);
  const addPick = useCalibrationStore((state) => state.addPick);
  const movePick = useCalibrationStore((state) => state.movePick);
  const closeMagnifier = useMagnifierStore((state) => state.close);

  const markingTarget = usePositionStore((state) => state.target);
  const positions = usePositionStore((state) => state.positions);
  const eventId = useAnnotationStore((state) => state.eventId);
  const events = useEventStore((state) => state.events);

  const probe = useLibraryStore((state) => state.probe);
  const videos = useLibraryStore((state) => state.videos);
  const activeVideoId = useLibraryStore((state) => state.activeVideoId);

  const frame = useMemo(
    () => ({ width: probe?.width ?? 0, height: probe?.height ?? 0 }),
    [probe?.width, probe?.height],
  );
  const size = useMemo(
    () => ({ lengthM: pitchLengthM, widthM: pitchWidthM }),
    [pitchLengthM, pitchWidthM],
  );

  const sourcePath = useMemo(() => {
    const video = videos.find((candidate) => candidate.id === activeVideoId);
    return video ? (video.playbackPath ?? video.path) : null;
  }, [videos, activeVideoId]);

  const close = useCallback(() => closeMagnifier(), [closeMagnifier]);

  // In position mode the calibration in force is the selected event's, exactly as
  // the marking overlay on the video uses.
  const event = events.find((candidate) => candidate.id === eventId) ?? null;
  const calibration = event ? activeCalibrationAt(calibrations, event.anchorMs) : null;

  // Calibration is a paused-frame activity, and a moving frame would make the
  // extracted still ambiguous about which moment it is.
  useEffect(() => {
    playback.pause();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  useEffect(() => {
    if (!sourcePath) {
      setFrameError("No video is open, so there is no frame to magnify.");
      return;
    }
    let cancelled = false;
    setFrameError(null);
    setFramePath(null);

    void ipc
      .extractFrame(sourcePath, atMs)
      .then((path) => {
        if (!cancelled) setFramePath(path);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFrameError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sourcePath, atMs]);

  // The asset protocol grants each extracted file; `lib/ipc` is the only module
  // allowed to know how that URL is formed.
  const resolvedUrl = useMemo(() => (framePath ? ipc.assetUrl(framePath) : null), [framePath]);

  useEffect(() => {
    const element = layerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setBox({ w: element.clientWidth, h: element.clientHeight });
    });
    observer.observe(element);
    setBox({ w: element.clientWidth, h: element.clientHeight });
    return () => observer.disconnect();
  }, []);

  const shown = useMemo(() => {
    const naturalWidth = image?.naturalWidth ?? 0;
    const naturalHeight = image?.naturalHeight ?? 0;
    if (naturalWidth <= 0 || naturalHeight <= 0 || box.w <= 0 || box.h <= 0) {
      return { w: 0, h: 0 };
    }
    const fit = Math.min(box.w / naturalWidth, box.h / naturalHeight);
    const scale = fit * zoom;
    return { w: naturalWidth * scale, h: naturalHeight * scale };
  }, [image, box.w, box.h, zoom]);

  // The outline follows the points being picked, or — when marking a player —
  // the stored calibration in force at that moment, so the pitch lines are still
  // drawn over the magnified frame for reference.
  const outlineSource = mode === "position" ? (calibration?.points ?? null) : picks;
  const outcome = useMemo(
    () =>
      frame.width > 0 && outlineSource && outlineSource.length > 0
        ? solvePicks(outlineSource, frame)
        : null,
    [outlineSource, frame],
  );
  const region = useMemo(
    () => (outlineSource && outlineSource.length >= 3 ? regionOf(outlineSource, size) : null),
    [outlineSource, size],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || shown.w <= 0 || shown.h <= 0) return;

    const ratio = window.devicePixelRatio || 1;
    const bitmapW = Math.max(1, Math.round(shown.w * ratio));
    const bitmapH = Math.max(1, Math.round(shown.h * ratio));
    if (canvas.width !== bitmapW) canvas.width = bitmapW;
    if (canvas.height !== bitmapH) canvas.height = bitmapH;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(bitmapW / shown.w, 0, 0, bitmapH / shown.h, 0, 0);
    ctx.clearRect(0, 0, shown.w, shown.h);

    const current = image;
    if (current) ctx.drawImage(current, 0, 0, shown.w, shown.h);

    if (!outcome?.ok || frame.width <= 0) return;
    const primitives: Primitive[] = outlinePrimitives(
      outcome.h,
      size,
      frame,
      { stroke: "#22D3EE", width: 0.0022, opacity: 0.9 },
      region,
    );
    renderPrimitives(primitives, ctx as unknown as Canvas2D, shown.w, shown.h);
  }, [shown.w, shown.h, image, outcome, frame, size, region]);

  useEffect(() => {
    draw();
  }, [draw]);

  const onCanvasDown = async (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = normaliseFromBox(
      event.currentTarget.getBoundingClientRect(),
      event.clientX,
      event.clientY,
    );
    if (!point) return;
    const [imageU, imageV] = point;

    if (mode === "position") {
      const store = usePositionStore.getState();
      if (!markingTarget) {
        store.reportError("Choose the player to mark before placing a position.");
        return;
      }

      const verdict = placeOnPitch({ calibration, click: { imageU, imageV }, frame, size });
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
      return;
    }

    if (pendingFeature !== null) void addPick(imageU, imageV);
  };

  const onMarkerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const feature = draggingRef.current;
    if (!feature || !layerRef.current) return;
    const point = normaliseFromBox(
      layerRef.current.getBoundingClientRect(),
      event.clientX,
      event.clientY,
    );
    if (point) movePick(feature, point[0], point[1]);
  };

  const zoomBy = (delta: number) => {
    setZoom((current) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current + delta)));
  };

  const pendingLabel = pendingFeature
    ? (findFeature(size, pendingFeature)?.label ?? pendingFeature)
    : null;
  const markers = pickMarkers(picks, { x: 0, y: 0, w: shown.w, h: shown.h });

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-black/95">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-label">
          {mode === "position" ? (
            markingTarget ? (
              <>
                Placing <strong>{markingTarget.playerName}</strong>
              </>
            ) : (
              "Choose the player to mark"
            )
          ) : pendingLabel ? (
            <>
              Picking <strong>{pendingLabel}</strong>
            </>
          ) : (
            "Adjusting the picked points"
          )}
        </span>
        <span className="text-caption text-muted-foreground">
          frame at {Math.floor(atMs / 60000)}:
          {String(Math.floor((atMs % 60000) / 1000)).padStart(2, "0")}
        </span>

        <span className="ml-auto flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Zoom out"
            disabled={zoom <= MIN_ZOOM}
            onClick={() => zoomBy(-1)}
          >
            <Minus className="size-3.5" aria-hidden="true" />
          </Button>
          <span className="w-10 text-center font-mono text-label tabular-nums">{zoom}×</span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Zoom in"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => zoomBy(1)}
          >
            <Plus className="size-3.5" aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setZoom(2)}>
            Reset
          </Button>
          <Button variant="outline" size="sm" onClick={close}>
            <X className="size-3.5" aria-hidden="true" />
            Done
          </Button>
        </span>
      </div>

      <div ref={layerRef} className="relative min-h-0 flex-1 overflow-auto p-2">
        {resolvedUrl ? (
          <img
            src={resolvedUrl}
            alt="The frame being calibrated, magnified"
            onLoad={(event) => setImage(event.currentTarget)}
            className="hidden"
          />
        ) : null}

        {frameError ? (
          <p role="alert" className="p-3 text-label text-danger">
            {frameError}
          </p>
        ) : !resolvedUrl ? (
          <p className="p-3 text-label text-muted-foreground">Extracting the frame…</p>
        ) : (
          <div className="relative" style={{ width: shown.w, height: shown.h }}>
            <canvas
              ref={canvasRef}
              aria-label={
                mode === "position"
                  ? "Magnified frame for placing player positions"
                  : "Magnified frame for picking reference points"
              }
              className={cn(
                "absolute inset-0 touch-none",
                (pendingFeature !== null || (mode === "position" && markingTarget)) &&
                  "cursor-crosshair",
              )}
              style={{ width: shown.w, height: shown.h }}
              onPointerDown={(event) => {
                void onCanvasDown(event);
              }}
            />
            <div className="pointer-events-none absolute inset-0">
              {mode === "position"
                ? positions.map((position) => (
                    <span
                      key={position.id}
                      aria-hidden="true"
                      title={`${position.shirtNumber ?? "?"} ${position.playerName} · ${position.teamName}`}
                      className="absolute grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white text-[10px] font-semibold text-white shadow"
                      style={{
                        left: position.imageU * shown.w,
                        top: position.imageV * shown.h,
                        background: position.teamColor ?? "#111827",
                      }}
                    >
                      {position.shirtNumber ?? "?"}
                    </span>
                  ))
                : markers.map((marker, index) => (
                    <button
                      key={marker.feature}
                      type="button"
                      title={`${marker.feature} — drag to adjust`}
                      aria-label={`Reference point ${index + 1}, ${marker.feature}. Drag to adjust, or use the arrow keys.`}
                      className="pointer-events-auto absolute grid size-4 -translate-x-1/2 -translate-y-1/2 cursor-grab place-items-center rounded-full border border-white bg-cyan-400 text-[9px] font-medium text-black active:cursor-grabbing"
                      style={{ left: marker.point[0], top: marker.point[1] }}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        event.currentTarget.setPointerCapture(event.pointerId);
                        draggingRef.current = marker.feature;
                      }}
                      onPointerMove={onMarkerMove}
                      onPointerUp={(event) => {
                        draggingRef.current = null;
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                          event.currentTarget.releasePointerCapture(event.pointerId);
                        }
                      }}
                      onPointerCancel={() => {
                        draggingRef.current = null;
                      }}
                    >
                      {index + 1}
                    </button>
                  ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border px-3 py-2 text-caption text-muted-foreground">
        <span>
          {mode === "position"
            ? "Click where the player is standing. Clicking again moves that player's marker."
            : "Click to place the point, drag a numbered dot to move it."}
        </span>
        {region && (
          <span className={cn(isNarrowCoverage(region) && "text-warning")}>
            {describeCoverage(region)}
          </span>
        )}
        {outcome?.ok === true && (
          <span className="ml-auto tabular-nums">
            {outcome.quality.rmsErrorPx.toFixed(1)} px average error
          </span>
        )}
      </div>
    </div>
  );
}
