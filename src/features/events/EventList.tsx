import { Scissors, Trash2 } from "lucide-react";
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
import { describeClosure } from "@/lib/phases/rules";
import { playback } from "@/lib/playback";
import { formatDurationMs, formatTimecode } from "@/lib/time/timecode";
import { cn } from "@/lib/utils";
import { useAnnotationStore } from "@/stores/annotationStore";
import { applyFilters, isFilterActive, useEventStore } from "@/stores/eventStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { usePhaseStore } from "@/stores/phaseStore";
import { usePositionStore } from "@/stores/positionStore";
import { openEvent } from "./openEvent";

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
  const countPositions = usePositionStore((state) => state.countFor);
  const actionsOf = usePhaseStore((state) => state.actionsOf);
  const [impact, setImpact] = useState<{
    drawings: number;
    positions: number;
    actions: number;
  } | null>(null);

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) return;
        // The actions inside a phase are kept when it is deleted (FR-55.5), so
        // the dialog says how many there are rather than implying they go too.
        void Promise.all([
          countDrawings(event.id),
          countPositions(event.id),
          actionsOf(event.id),
        ]).then(([drawings, positions, actions]) => setImpact({ drawings, positions, actions }));
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
            {impact
              ? [
                  impact.drawings > 0
                    ? `${impact.drawings} drawing${impact.drawings === 1 ? "" : "s"}`
                    : null,
                  impact.positions > 0
                    ? `${impact.positions} position${impact.positions === 1 ? "" : "s"}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" and ")
                  .replace(/^./, (first) => first.toUpperCase())
              : ""}
            {impact && (impact.drawings > 0 || impact.positions > 0) ? " go with it." : ""}
            {impact && impact.actions > 0
              ? ` ${impact.actions} action${impact.actions === 1 ? "" : "s"} recorded inside it ${
                  impact.actions === 1 ? "is" : "are"
                } kept, and no longer belongs to a phase.`
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
  const allEvents = useEventStore((state) => state.events);
  const phaseTagIds = usePhaseStore((state) => state.phaseTagIds);
  const closures = usePhaseStore((state) => state.closures);
  const links = usePhaseStore((state) => state.links);

  const isPhase = phaseTagIds.includes(event.tagId);
  // What this event belongs to, if it was recorded inside a phase (FR-55.3).
  const parents = links
    .filter((link) => link.childId === event.id)
    .map((link) => allEvents.find((candidate) => candidate.id === link.parentId))
    .filter((parent): parent is EventRow => parent !== undefined);

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
          onClick={() => openEvent(event)}
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
            {/* A phase's length and how it ended, in words: the record must say
                whether the user stopped it or the app did (FR-55.4). */}
            {/* Only a **run** carries a length: a one-press capture of a
                phase-tagged tag has padding, and padding is not a duration. */}
            {isPhase && closures[event.id] !== undefined && (
              <span className="shrink-0 rounded-sm bg-muted px-1 font-mono text-caption tabular-nums text-muted-foreground">
                {formatDurationMs(Math.max(0, event.endMs - event.startMs))}
              </span>
            )}
          </span>
          <span className="mt-0.5 block font-mono text-label tabular-nums text-muted-foreground">
            {formatTimecode(event.anchorMs)}
            {event.teamName ? ` · ${event.teamName}` : ""}
            {event.playerName ? ` · ${event.playerName}` : ""}
            {isPhase ? ` · ${describeClosure(closures[event.id])}` : ""}
            {parents.length > 0
              ? ` · inside ${parents.map((parent) => parent.tagName).join(" and ")}`
              : ""}
          </span>
        </button>

        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Split ${event.tagName} at the playhead`}
          title="Split this event at the playhead into two"
          onClick={() => void useEventStore.getState().splitEvent(event.id, playback.timeMs)}
        >
          <Scissors className="size-3" aria-hidden="true" />
        </Button>
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
