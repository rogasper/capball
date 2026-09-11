import { useEffect, useRef } from "react";
import { playback } from "@/lib/playback";
import { useLibraryStore } from "@/stores/libraryStore";
import { usePlayerStore } from "@/stores/playerStore";

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
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (element) playback.attach(element);
    return () => playback.detach();
  }, []);

  useEffect(() => playback.onState((state) => usePlayerStore.getState().apply(state)), []);

  return (
    <section className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
      {/* biome-ignore lint/a11y/useMediaCaption: match footage is supplied by the user and carries no caption track; the app cannot invent one. */}
      <video
        ref={videoRef}
        src={playbackUrl ?? undefined}
        className={playbackUrl ? "max-h-full max-w-full" : "hidden"}
        playsInline
        preload="metadata"
      />

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
