import { FileVideo, Loader2, Trash2 } from "lucide-react";
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
import { formatTimecode } from "@/lib/time/timecode";
import { cn } from "@/lib/utils";
import { useLibraryStore } from "@/stores/libraryStore";
import { SquadPanel } from "./SquadPanel";

function ProgressBar({ outTimeMs, totalMs }: { outTimeMs: number; totalMs: number }) {
  const percent = totalMs > 0 ? Math.min(100, Math.round((outTimeMs / totalMs) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-label tabular-nums text-muted-foreground">{percent}%</p>
    </div>
  );
}

export function MatchPanel() {
  const currentMatch = useLibraryStore((state) => state.currentMatch);
  const matches = useLibraryStore((state) => state.matches);
  const videos = useLibraryStore((state) => state.videos);
  const activeVideoId = useLibraryStore((state) => state.activeVideoId);
  const phase = useLibraryStore((state) => state.phase);
  const note = useLibraryStore((state) => state.note);
  const error = useLibraryStore((state) => state.error);
  const progress = useLibraryStore((state) => state.progress);

  const addVideo = useLibraryStore((state) => state.addVideoToCurrentMatch);
  const selectVideo = useLibraryStore((state) => state.selectVideo);
  const removeVideo = useLibraryStore((state) => state.removeVideo);
  const removeMatch = useLibraryStore((state) => state.removeMatch);
  const cancelPreparation = useLibraryStore((state) => state.cancelPreparation);

  const [confirmingVideo, setConfirmingVideo] = useState<number | null>(null);

  if (!currentMatch) {
    return (
      <div className="space-y-2">
        <h2 className="text-title">Match</h2>
        <p className="text-body text-muted-foreground">
          Select a match on the left, or create one. Videos and analysis belong to a match.
        </p>
      </div>
    );
  }

  const summary = matches.find((match) => match.id === currentMatch.id);
  const busy = phase === "probing" || phase === "preparing";

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-title">
            {summary ? `${summary.homeTeam} vs ${summary.awayTeam}` : "Match"}
          </h2>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Delete match">
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this match?</AlertDialogTitle>
                <AlertDialogDescription>
                  Its {videos.length} video{videos.length === 1 ? "" : "s"} and any tagged events
                  are removed from the library. The video files on disk are never touched.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => void removeMatch(currentMatch.id)}
                >
                  Delete match
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <p className="text-label text-muted-foreground">
          {[summary?.competition, currentMatch.season, currentMatch.venue]
            .filter(Boolean)
            .join(" · ") || "No competition or venue recorded"}
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="text-label text-muted-foreground">Videos</h3>

        {videos.length === 0 ? (
          <p className="text-body text-muted-foreground">
            No video yet. Add one — halves or camera angles can be added separately.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {videos.map((video) => {
              const isActive = video.id === activeVideoId;
              return (
                <li
                  key={video.id}
                  className={cn(
                    "flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5",
                    isActive && "border-border bg-card",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => void selectVideo(video.id)}
                    aria-current={isActive ? "true" : undefined}
                    className="min-w-0 flex-1 text-left focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <span className="block truncate text-body">{video.fileName}</span>
                    <span className="block font-mono text-label tabular-nums text-muted-foreground">
                      {formatTimecode(video.durationMs)}
                      {video.width && video.height ? ` · ${video.width}×${video.height}` : ""}
                      {video.videoCodec ? ` · ${video.videoCodec}` : ""}
                    </span>
                  </button>

                  <AlertDialog
                    open={confirmingVideo === video.id}
                    onOpenChange={(open) => setConfirmingVideo(open ? video.id : null)}
                  >
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${video.fileName}`}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove this video?</AlertDialogTitle>
                        <AlertDialogDescription>
                          It is removed from the library, along with any events tagged on it. The
                          file on disk is left alone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep it</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => void removeVideo(video.id)}
                        >
                          Remove video
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </li>
              );
            })}
          </ul>
        )}

        <Button onClick={() => void addVideo()} disabled={busy} className="w-full">
          {phase === "probing" ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Reading details…
            </>
          ) : (
            <>
              <FileVideo className="size-4" aria-hidden="true" />
              Add a video
            </>
          )}
        </Button>
      </div>

      {phase === "preparing" && (
        <div className="space-y-2 rounded-lg border border-border bg-card p-3">
          <p className="text-body">Preparing this file so the player can open it.</p>
          {note && <p className="text-label text-muted-foreground">{note}</p>}
          {progress && <ProgressBar {...progress} />}
          <Button variant="outline" size="sm" onClick={() => void cancelPreparation()}>
            Cancel
          </Button>
        </div>
      )}

      {phase === "missing" && error && (
        <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
          <p className="text-body">{error}</p>
        </div>
      )}

      {phase === "error" && error && (
        <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3">
          <p className="text-body break-words">{error}</p>
        </div>
      )}

      <div className="border-t border-border pt-3">
        <SquadPanel />
      </div>
    </div>
  );
}
