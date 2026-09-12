import { CornerDownLeft, Undo2, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { playback } from "@/lib/playback";
import { formatTimecode } from "@/lib/time/timecode";
import { useEventStore } from "@/stores/eventStore";
import { useLibraryStore } from "@/stores/libraryStore";

const ADJUST_MS = 1_000;

/**
 * A thin rail showing where the captures landed, plus the playhead.
 *
 * This is deliberately not the timeline: no zoom, pan, filtering, or range
 * selection — that is M4. It exists so a capture is visible the instant it
 * happens (FR-5.1).
 */
function Rail() {
  const events = useEventStore((state) => state.events);
  const lastCapturedId = useEventStore((state) => state.lastCapturedId);
  const durationMs = useLibraryStore((state) => state.probe?.durationMs ?? 0);
  const playhead = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      playback.onFrame((timeMs) => {
        const element = playhead.current;
        if (!element) return;
        const share = durationMs > 0 ? Math.min(1, Math.max(0, timeMs / durationMs)) : 0;
        element.style.left = `${share * 100}%`;
      }),
    [durationMs],
  );

  return (
    <div
      className="relative h-8 w-full rounded-md border border-border bg-background"
      role="img"
      aria-label={`${events.length} tagged moments`}
    >
      {durationMs > 0 &&
        events.map((event) => (
          <span
            key={event.id}
            className="absolute top-1 bottom-1 w-1 rounded-full"
            style={{
              // Markers sit on the tagged moment, not on the start of the clip
              // range, so the rail agrees with what the list shows.
              left: `${Math.min(100, (event.anchorMs / durationMs) * 100)}%`,
              background: event.tagColor ?? "var(--muted-foreground)",
              outline: event.id === lastCapturedId ? "1px solid var(--foreground)" : undefined,
            }}
            title={`${event.tagName} · ${formatTimecode(event.anchorMs)} (clip ${formatTimecode(
              event.startMs,
            )} → ${formatTimecode(event.endMs)})`}
          />
        ))}

      <div
        ref={playhead}
        className="absolute top-0 bottom-0 w-px bg-primary"
        style={{ left: "0%" }}
        aria-hidden="true"
      />
    </div>
  );
}

/** The capture that was just made, correctable without leaving the moment (FR-5.3). */
function LastCapture() {
  const events = useEventStore((state) => state.events);
  const lastCapturedId = useEventStore((state) => state.lastCapturedId);
  const undoLast = useEventStore((state) => state.undoLast);
  const adjustEnd = useEventStore((state) => state.adjustEnd);

  const last = events.find((event) => event.id === lastCapturedId);
  if (!last) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-label">
      <span className="flex items-center gap-1.5">
        <span
          className="size-2 rounded-full"
          style={{ background: last.tagColor ?? "var(--muted-foreground)" }}
          aria-hidden="true"
        />
        <span className="text-body">{last.tagName}</span>
        <span className="text-caption text-muted-foreground">tagged</span>
        <span className="font-mono tabular-nums">{formatTimecode(last.anchorMs)}</span>
        <span className="font-mono text-caption tabular-nums text-muted-foreground">
          clip starts {formatTimecode(last.startMs)} → {formatTimecode(last.endMs)}
        </span>
      </span>

      <span className="flex items-center gap-1">
        <Button
          variant="outline"
          size="xs"
          aria-label="Shorten the end by one second"
          onClick={() => void adjustEnd(last.id, -ADJUST_MS)}
        >
          end −1s
        </Button>
        <Button
          variant="outline"
          size="xs"
          aria-label="Extend the end by one second"
          onClick={() => void adjustEnd(last.id, ADJUST_MS)}
        >
          end +1s
        </Button>
        <Button variant="ghost" size="xs" onClick={() => void undoLast()}>
          <Undo2 className="size-3" aria-hidden="true" />
          Undo
        </Button>
      </span>
    </div>
  );
}

export function CaptureRail() {
  const hasVideo = useLibraryStore((state) => state.activeVideoId) !== null;
  const events = useEventStore((state) => state.events);
  const lastCapturedId = useEventStore((state) => state.lastCapturedId);
  const error = useEventStore((state) => state.error);
  const clearError = useEventStore((state) => state.clearError);

  return (
    <div className="space-y-2 border-t border-border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-label text-muted-foreground">
          <CornerDownLeft className="size-3" aria-hidden="true" />
          {hasVideo
            ? "Press a bound tag key to capture this moment"
            : "Add a video to start capturing"}
        </span>
        <span className="text-caption tabular-nums text-muted-foreground">
          {events.length} event{events.length === 1 ? "" : "s"}
        </span>
      </div>

      <Rail />

      {lastCapturedId !== null && <LastCapture />}

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-danger/40 bg-danger/10 px-2 py-1"
        >
          <p className="flex-1 text-label break-words">{error}</p>
          <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={clearError}>
            <X className="size-3" aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
}
