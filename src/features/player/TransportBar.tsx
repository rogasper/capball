import { ChevronLeft, ChevronRight, Pause, Play, StepBack, StepForward } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { playback } from "@/lib/playback";
import { formatTimecode } from "@/lib/time/timecode";
import { useLibraryStore } from "@/stores/libraryStore";
import { usePlayerStore } from "@/stores/playerStore";

const NUDGE_MS = 5_000;
const RATES = [0.5, 1, 1.5, 2];

/** Live playhead readout: updated from the controller, never through React state. */
function TimecodeReadout() {
  const readout = useRef<HTMLSpanElement>(null);
  const durationMs = usePlayerStore((state) => state.durationMs);

  useEffect(
    () =>
      playback.onFrame((timeMs) => {
        if (readout.current) readout.current.textContent = formatTimecode(timeMs);
      }),
    [],
  );

  return (
    <p className="font-mono text-body tabular-nums">
      <span ref={readout}>00:00.000</span>
      <span className="text-muted-foreground"> / {formatTimecode(durationMs)}</span>
    </p>
  );
}

function Scrubber() {
  const input = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);
  const durationMs = usePlayerStore((state) => state.durationMs);

  useEffect(
    () =>
      playback.onFrame((timeMs) => {
        const element = input.current;
        if (element && !dragging.current) element.value = String(Math.round(timeMs));
      }),
    [],
  );

  return (
    <input
      ref={input}
      type="range"
      min={0}
      max={Math.max(1, Math.round(durationMs))}
      step={1}
      defaultValue={0}
      aria-label="Playhead"
      className="h-4 w-full cursor-pointer accent-[var(--primary)]"
      onPointerDown={() => {
        dragging.current = true;
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onChange={(event) => playback.seekMs(Number(event.currentTarget.value))}
    />
  );
}

export function TransportBar() {
  const paused = usePlayerStore((state) => state.paused);
  const rate = usePlayerStore((state) => state.rate);
  const ready = usePlayerStore((state) => state.ready);
  const probe = useLibraryStore((state) => state.probe);
  const hasVideo = useLibraryStore((state) => state.playbackUrl) !== null;

  const frameStep = (frames: number) => {
    if (!probe) return;
    const frameMs = probe.fpsNum && probe.fpsDen ? (1000 * probe.fpsDen) / probe.fpsNum : 0;
    if (frameMs > 0) playback.nudge(frames * frameMs);
  };

  return (
    <div className="flex flex-col gap-2 border-t border-border bg-card px-4 py-3">
      <Scrubber />
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back one frame"
            disabled={!ready || !probe?.fpsNum}
            onClick={() => frameStep(-1)}
          >
            <StepBack className="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back five seconds"
            disabled={!ready}
            onClick={() => playback.nudge(-NUDGE_MS)}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={paused ? "Play" : "Pause"}
            disabled={!ready}
            onClick={() => playback.toggle()}
          >
            {paused ? (
              <Play className="size-4" aria-hidden="true" />
            ) : (
              <Pause className="size-4" aria-hidden="true" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Forward five seconds"
            disabled={!ready}
            onClick={() => playback.nudge(NUDGE_MS)}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Forward one frame"
            disabled={!ready || !probe?.fpsNum}
            onClick={() => frameStep(1)}
          >
            <StepForward className="size-4" aria-hidden="true" />
          </Button>
        </div>

        <TimecodeReadout />

        <label className="flex items-center gap-2 text-label text-muted-foreground">
          Speed
          <select
            value={rate}
            disabled={!hasVideo}
            onChange={(event) => playback.setRate(Number(event.currentTarget.value))}
            className="rounded-md border border-input bg-background px-2 py-1 font-mono text-label tabular-nums"
          >
            {RATES.map((option) => (
              <option key={option} value={option}>
                {option}×
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
