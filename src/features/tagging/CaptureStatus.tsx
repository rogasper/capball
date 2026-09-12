import { CornerDownLeft, Undo2, X } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { formatTimecode } from "@/lib/time/timecode";
import { useEventStore } from "@/stores/eventStore";
import { useLibraryStore } from "@/stores/libraryStore";

const ADJUST_MS = 1_000;

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

/**
 * Status for the capture keys: what to do, what was just captured, and anything
 * that went wrong. The markers themselves live in the timeline.
 */
export function CaptureStatus() {
  const hasVideo = useLibraryStore((state) => state.activeVideoId) !== null;
  const events = useEventStore((state) => state.events);
  const lastCapturedId = useEventStore((state) => state.lastCapturedId);
  const error = useEventStore((state) => state.error);
  const clearError = useEventStore((state) => state.clearError);

  const count = useMemo(() => events.length, [events]);

  return (
    <div className="space-y-2 border-t border-border bg-card px-4 pb-3">
      <div className="flex items-center justify-between gap-3 pt-2">
        <span className="flex items-center gap-1.5 text-label text-muted-foreground">
          <CornerDownLeft className="size-3" aria-hidden="true" />
          {hasVideo
            ? "Press a bound tag key to capture this moment"
            : "Add a video to start capturing"}
        </span>
        <span className="text-caption tabular-nums text-muted-foreground">
          {count} event{count === 1 ? "" : "s"}
        </span>
      </div>

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
