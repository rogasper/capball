import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ReviewBar } from "@/features/review/ReviewBar";
import type { EventRow } from "@/lib/db/queries/events";
import { ON_DEMAND, useThumbnail } from "@/lib/media/thumbnails";
import { playback } from "@/lib/playback";
import { formatTimecode } from "@/lib/time/timecode";
import { cn } from "@/lib/utils";
import { useAnnotationStore } from "@/stores/annotationStore";
import { applyFilters, isFilterActive, useEventStore } from "@/stores/eventStore";
import { useLibraryStore } from "@/stores/libraryStore";

function NotesField({ eventId, notes }: { eventId: number; notes: string | null }) {
  const updateNotes = useEventStore((state) => state.updateNotes);
  const [draft, setDraft] = useState(notes ?? "");

  const commit = () => {
    if ((notes ?? "") !== draft) void updateNotes(eventId, draft);
  };

  return (
    <Input
      value={draft}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commit();
          event.currentTarget.blur();
        }
      }}
      placeholder="Note…"
      className="h-6 text-label"
      aria-label="Event note"
    />
  );
}

/** Rendered only once the row is near the viewport, so a long list stays cheap. */
function EventThumbnail({ event, sourcePath }: { event: EventRow; sourcePath: string | null }) {
  const { state, ref } = useThumbnail(sourcePath, event.anchorMs, ON_DEMAND);

  return (
    <span
      ref={ref}
      className="block h-9 w-16 shrink-0 overflow-hidden rounded border border-border bg-muted"
    >
      {state.status === "ready" ? (
        <img src={state.url} alt="" className="size-full object-cover" />
      ) : (
        <span
          className="flex size-full items-center justify-center text-caption text-muted-foreground"
          title={state.status === "failed" ? state.error : undefined}
        >
          {state.status === "failed" ? "!" : ""}
        </span>
      )}
    </span>
  );
}

/**
 * Deleting an event takes its drawings with it, so the dialog says how many
 * before it happens (FR-20.6) rather than surprising the user afterwards.
 */
function DeleteEventDialog({ event }: { event: EventRow }) {
  const remove = useEventStore((state) => state.remove);
  const countDrawings = useAnnotationStore((state) => state.countDrawings);
  const [drawings, setDrawings] = useState<number | null>(null);

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (open) void countDrawings(event.id).then(setDrawings);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Delete ${event.tagName} at ${formatTimecode(event.anchorMs)}`}
        >
          <Trash2 className="size-3" aria-hidden="true" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this event?</AlertDialogTitle>
          <AlertDialogDescription>
            {event.tagName} at {formatTimecode(event.anchorMs)} is removed from the match.
            {drawings !== null && drawings > 0
              ? ` Its ${drawings} drawing${drawings === 1 ? "" : "s"} go with it.`
              : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void remove(event.id)}>
            Delete event
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function EventRowItem({ event, sourcePath }: { event: EventRow; sourcePath: string | null }) {
  const lastCapturedId = useEventStore((state) => state.lastCapturedId);

  return (
    <li
      className={cn(
        "rounded-md border border-transparent px-2 py-1.5",
        event.id === lastCapturedId && "border-border bg-background",
      )}
    >
      <div className="flex items-start gap-2">
        <EventThumbnail event={event} sourcePath={sourcePath} />

        <button
          type="button"
          onClick={() => {
            playback.seekMs(event.anchorMs);
            void useAnnotationStore.getState().load(event.id);
          }}
          aria-label={`Jump to ${formatTimecode(event.anchorMs)}`}
          className="min-w-0 flex-1 text-left focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          title={`Jump to ${formatTimecode(event.anchorMs)} (clip ${formatTimecode(
            event.startMs,
          )} → ${formatTimecode(event.endMs)})`}
        >
          <span className="flex items-center gap-1.5">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: event.tagColor ?? "var(--muted-foreground)" }}
              aria-hidden="true"
            />
            <span className="truncate text-body">{event.tagName}</span>
          </span>
          <span className="mt-0.5 block font-mono text-label tabular-nums text-muted-foreground">
            {formatTimecode(event.anchorMs)}
            {event.teamName ? ` · ${event.teamName}` : ""}
            {event.playerName ? ` · ${event.playerName}` : ""}
          </span>
        </button>

        <DeleteEventDialog event={event} />
      </div>

      <div className="mt-1 pl-18">
        <NotesField eventId={event.id} notes={event.notes} />
      </div>
    </li>
  );
}

export function EventList() {
  const events = useEventStore((state) => state.events);
  const filters = useEventStore((state) => state.filters);
  const clearFilters = useEventStore((state) => state.clearFilters);

  const videos = useLibraryStore((state) => state.videos);
  const activeVideoId = useLibraryStore((state) => state.activeVideoId);

  // ffmpeg reads the source file; the prepared copy is still a copy of it.
  const sourcePath = useMemo(() => {
    const video = videos.find((candidate) => candidate.id === activeVideoId);
    return video ? (video.playbackPath ?? video.path) : null;
  }, [videos, activeVideoId]);

  const visible = useMemo(() => applyFilters(events, filters), [events, filters]);
  const filtered = isFilterActive(filters);

  if (events.length === 0) {
    return (
      <div className="space-y-2">
        <h2 className="text-title">Events</h2>
        <p className="text-body text-muted-foreground">
          Nothing tagged yet. Press a bound tag key while watching and the moment appears here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-title">Events</h2>
        <span className="text-caption tabular-nums text-muted-foreground">
          {filtered ? `${visible.length} of ${events.length}` : `${events.length} in order`}
        </span>
      </div>

      <ReviewBar events={visible} />

      {filtered && (
        <div className="flex items-center gap-2 text-label text-muted-foreground">
          <span>Filtered</span>
          <Button variant="ghost" size="xs" onClick={clearFilters}>
            Show all
          </Button>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-body text-muted-foreground">
          No events match this filter. Clear it to see everything again.
        </p>
      ) : (
        <ul className="space-y-1">
          {visible.map((event) => (
            <EventRowItem key={event.id} event={event} sourcePath={sourcePath} />
          ))}
        </ul>
      )}
    </div>
  );
}
