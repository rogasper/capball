import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EventRow } from "@/lib/db/queries/events";
import { formatTimecode } from "@/lib/time/timecode";
import { useReviewStore } from "@/stores/reviewStore";

/**
 * Review mode controls (FR-14).
 *
 * Plays whatever the list is currently showing — the filter is the selection —
 * so "review all shots" is a filter away rather than a separate feature.
 */
export function ReviewBar({ events }: { events: EventRow[] }) {
  const active = useReviewStore((state) => state.active);
  const queue = useReviewStore((state) => state.queue);
  const index = useReviewStore((state) => state.index);
  const error = useReviewStore((state) => state.error);
  const start = useReviewStore((state) => state.start);
  const stop = useReviewStore((state) => state.stop);
  const next = useReviewStore((state) => state.next);
  const previous = useReviewStore((state) => state.previous);
  const clearError = useReviewStore((state) => state.clearError);

  const current = queue[index];

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {active && current ? (
          <>
            <span className="font-mono text-label tabular-nums text-muted-foreground">
              {index + 1}/{queue.length}
            </span>
            <span className="truncate text-body">{current.tagName}</span>
            <span className="font-mono text-caption tabular-nums text-muted-foreground">
              {formatTimecode(current.startMs)} → {formatTimecode(current.endMs)}
            </span>
            <span className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" aria-label="Previous clip" onClick={previous}>
                <SkipBack className="size-3.5" aria-hidden="true" />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Next clip" onClick={next}>
                <SkipForward className="size-3.5" aria-hidden="true" />
              </Button>
              <Button variant="outline" size="xs" onClick={stop}>
                <Pause className="size-3" aria-hidden="true" />
                Stop
              </Button>
            </span>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={events.length === 0}
            onClick={() => start(events)}
          >
            <Play className="size-3.5" aria-hidden="true" />
            Review {events.length === 1 ? "this moment" : `these ${events.length}`}
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="flex items-center gap-2 text-label text-warning">
          {error}
          <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={clearError}>
            ×
          </Button>
        </p>
      )}
    </div>
  );
}
