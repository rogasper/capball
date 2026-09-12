import { Trash2 } from "lucide-react";
import { useState } from "react";
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
import { playback } from "@/lib/playback";
import { formatTimecode } from "@/lib/time/timecode";
import { cn } from "@/lib/utils";
import { useEventStore } from "@/stores/eventStore";

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

export function EventList() {
  const events = useEventStore((state) => state.events);
  const lastCapturedId = useEventStore((state) => state.lastCapturedId);
  const remove = useEventStore((state) => state.remove);

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
          {events.length} in order
        </span>
      </div>

      <ul className="space-y-1">
        {events.map((event) => (
          <li
            key={event.id}
            className={cn(
              "rounded-md border border-transparent px-2 py-1.5",
              event.id === lastCapturedId && "border-border bg-background",
            )}
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => playback.seekMs(event.anchorMs)}
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

              <AlertDialog>
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
            </div>

            <div className="mt-1 pl-3.5">
              <NotesField eventId={event.id} notes={event.notes} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
