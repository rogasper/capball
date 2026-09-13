import { useEffect, useRef } from "react";
import { AnnotationCanvas } from "@/features/annotate/AnnotationCanvas";
import { CalibrationOverlay } from "@/features/pitch/CalibrationOverlay";
import { MagnifiedPicker } from "@/features/pitch/MagnifiedPicker";
import { PositionOverlay } from "@/features/pitch/PositionOverlay";
import { playback } from "@/lib/playback";
import { useCalibrationStore } from "@/stores/calibrationStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useMagnifierStore } from "@/stores/magnifierStore";
import { usePlayerStore } from "@/stores/playerStore";
import { usePositionStore } from "@/stores/positionStore";

function EmptyStage() {
  return (
    <div className="max-w-sm space-y-2 text-center">
      <p className="text-title text-foreground">No video loaded</p>
      <p className="text-body text-muted-foreground">
        Import a match video to start watching. Everything stays on this computer.
      </p>
    </div>
  );
}

export function PlayerStage() {
  const playbackUrl = useLibraryStore((state) => state.playbackUrl);
  const playerError = usePlayerStore((state) => state.error);
  // Calibration takes the clicks while a point is being placed.
  const picking = useCalibrationStore((state) => state.pendingFeature) !== null;
  // Marking takes the clicks too, so the drawing layer stands aside for it.
  const marking = usePositionStore((state) => state.marking);
  // The magnified view covers the stage when it is open, for either flow.
  const magnifierMode = useMagnifierStore((state) => state.mode);
  const stageRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (element) playback.attach(element);
    return () => playback.detach();
  }, []);

  useEffect(() => playback.onState((state) => usePlayerStore.getState().apply(state)), []);

  return (
    <section
      ref={stageRef}
      className="relative flex min-h-0 flex-1 items-center justify-center bg-black"
    >
      {/* biome-ignore lint/a11y/useMediaCaption: match footage is supplied by the user and carries no caption track; the app cannot invent one. */}
      <video
        ref={videoRef}
        src={playbackUrl ?? undefined}
        // The element fills the stage and letterboxes the picture inside it, so
        // the annotation canvas can be placed on the picture exactly by
        // `contentRect` rather than by guessing.
        className={playbackUrl ? "size-full object-contain" : "hidden"}
        playsInline
        preload="metadata"
      />

      <AnnotationCanvas
        stageRef={stageRef}
        videoRef={videoRef}
        interactive={!picking && !marking}
      />
      <CalibrationOverlay stageRef={stageRef} videoRef={videoRef} />
      <PositionOverlay stageRef={stageRef} videoRef={videoRef} />

      {playbackUrl && magnifierMode !== null && <MagnifiedPicker mode={magnifierMode} />}

      {!playbackUrl && <EmptyStage />}

      {playerError && (
        <p
          role="alert"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md border border-danger/40 bg-danger/15 px-3 py-1.5 text-label"
        >
          {playerError}
        </p>
      )}
    </section>
  );
}
