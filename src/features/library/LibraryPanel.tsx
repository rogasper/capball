import { FileVideo, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTimecode } from "@/lib/time/timecode";
import { useLibraryStore } from "@/stores/libraryStore";
import { useSettingsStore } from "@/stores/settingsStore";

function fileName(path: string | null): string {
  if (!path) return "";
  return path.split("/").pop() ?? path;
}

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

export function LibraryPanel() {
  const phase = useLibraryStore((state) => state.phase);
  const note = useLibraryStore((state) => state.note);
  const error = useLibraryStore((state) => state.error);
  const progress = useLibraryStore((state) => state.progress);
  const probe = useLibraryStore((state) => state.probe);
  const sourcePath = useLibraryStore((state) => state.sourcePath);
  const importVideo = useLibraryStore((state) => state.importVideo);
  const cancelPreparation = useLibraryStore((state) => state.cancelPreparation);

  const tools = useSettingsStore((state) => state.tools);
  const toolsReady = tools?.ffmpeg === true && tools.ffprobe === true;

  return (
    <div className="flex h-full flex-col gap-4">
      <div>
        <h2 className="text-title">Match video</h2>
        <p className="text-label text-muted-foreground">
          Import one file to start. Analysis is kept in memory until the library lands.
        </p>
      </div>

      <Button
        onClick={() => void importVideo()}
        disabled={!toolsReady || phase === "probing" || phase === "preparing"}
        className="w-full"
      >
        {phase === "probing" ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Reading details…
          </>
        ) : (
          <>
            <FileVideo className="size-4" aria-hidden="true" />
            {phase === "ready" ? "Import another video" : "Import a match video"}
          </>
        )}
      </Button>

      {phase === "empty" && (
        <p className="text-body text-muted-foreground">
          Nothing imported yet. Pick a match file — mp4, mov or mkv all work.
        </p>
      )}

      {phase === "preparing" && (
        <div className="space-y-2">
          <p className="text-body">Preparing this file so the player can open it.</p>
          {note && <p className="text-label text-muted-foreground">{note}</p>}
          {progress && <ProgressBar {...progress} />}
          <Button variant="outline" size="sm" onClick={() => void cancelPreparation()}>
            Cancel
          </Button>
        </div>
      )}

      {phase === "ready" && probe && (
        <div className="space-y-2 rounded-lg border border-border bg-card p-3">
          <p className="truncate text-body-lg" title={sourcePath ?? undefined}>
            {fileName(sourcePath)}
          </p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-label">
            <dt className="text-muted-foreground">Duration</dt>
            <dd className="font-mono tabular-nums">{formatTimecode(probe.durationMs)}</dd>
            <dt className="text-muted-foreground">Resolution</dt>
            <dd className="font-mono tabular-nums">
              {probe.width && probe.height ? `${probe.width}×${probe.height}` : "unknown"}
            </dd>
            <dt className="text-muted-foreground">Frame rate</dt>
            <dd className="font-mono tabular-nums">
              {probe.fpsNum && probe.fpsDen
                ? `${(probe.fpsNum / probe.fpsDen).toFixed(2)} fps`
                : "unknown"}
            </dd>
            <dt className="text-muted-foreground">Codecs</dt>
            <dd className="truncate font-mono">
              {[probe.videoCodec, probe.audioCodec].filter(Boolean).join(" / ") || "unknown"}
            </dd>
          </dl>
          {note && <p className="text-caption text-muted-foreground">{note}</p>}
        </div>
      )}

      {phase === "missing" && (
        <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
          <p className="text-body">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void importVideo()}>
            Choose the file again
          </Button>
        </div>
      )}

      {phase === "error" && (
        <div role="alert" className="space-y-2 rounded-lg border border-danger/40 bg-danger/10 p-3">
          <p className="text-body break-words">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void importVideo()}>
            Try another file
          </Button>
        </div>
      )}
    </div>
  );
}
