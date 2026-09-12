import { Check, ExternalLink, FolderOpen, Loader2, SquareArrowOutUpRight, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AVAILABLE_PLACEHOLDERS, planNames } from "@/lib/export/filename";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { applyFilters, isFilterActive, useEventStore } from "@/stores/eventStore";
import { useExportStore } from "@/stores/exportStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useSettingsStore } from "@/stores/settingsStore";

/**
 * First run, in full (T2, FR-9.6).
 *
 * capball does not download anything: it looks for FFmpeg and, if it is missing,
 * says so before the user tries to export rather than failing afterwards. That
 * also means the whole app works offline, since there is nothing to fetch.
 */
function MissingTools() {
  const [failed, setFailed] = useState<string | null>(null);

  const openPage = async () => {
    try {
      await ipc.openExternal("https://ffmpeg.org/download.html");
      setFailed(null);
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div role="alert" className="space-y-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
      <p className="text-body font-medium">Exporting needs FFmpeg</p>
      <p className="text-body text-muted-foreground">
        capball uses the FFmpeg already on your computer; it does not download or bundle one.
        Install it once and reopening the app is all that is needed.
      </p>
      <p className="rounded-md bg-background px-2 py-1 font-mono text-label">brew install ffmpeg</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void openPage()}>
          <ExternalLink className="size-3.5" aria-hidden="true" />
          Open the download page
        </Button>
        <span className="text-caption text-muted-foreground">
          Everything else — importing, tagging, the timeline — works without it.
        </span>
      </div>
      {failed && <p className="text-label text-danger">Could not open the page: {failed}</p>}
    </div>
  );
}

function Progress() {
  const totalSteps = useExportStore((state) => state.totalSteps);
  const completedSteps = useExportStore((state) => state.completedSteps);
  const stepProgress = useExportStore((state) => state.stepProgress);
  const currentLabel = useExportStore((state) => state.currentLabel);
  const cancel = useExportStore((state) => state.cancel);

  const overall = totalSteps > 0 ? Math.min(1, (completedSteps + stepProgress) / totalSteps) : 0;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-body">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          {currentLabel ? `Writing ${currentLabel}` : "Starting…"}
        </span>
        <span className="font-mono text-label tabular-nums text-muted-foreground">
          {completedSteps}/{totalSteps}
        </span>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-200"
          style={{ width: `${Math.round(overall * 100)}%` }}
        />
      </div>

      <Button variant="outline" size="sm" onClick={() => void cancel()}>
        Cancel
      </Button>
    </div>
  );
}

export function ExportPanel() {
  const events = useEventStore((state) => state.events);
  const filters = useEventStore((state) => state.filters);
  const currentMatch = useLibraryStore((state) => state.currentMatch);
  const matches = useLibraryStore((state) => state.matches);
  const videos = useLibraryStore((state) => state.videos);
  const activeVideoId = useLibraryStore((state) => state.activeVideoId);
  const tools = useSettingsStore((state) => state.tools);

  const destination = useSettingsStore((state) => state.exportDestination);
  const template = useSettingsStore((state) => state.exportTemplate);
  const mode = useSettingsStore((state) => state.exportMode);
  const extraBeforeMs = useSettingsStore((state) => state.exportExtraBeforeMs);
  const extraAfterMs = useSettingsStore((state) => state.exportExtraAfterMs);
  const concatenate = useSettingsStore((state) => state.exportConcatenate);
  const settingsLoaded = useSettingsStore((state) => state.loaded);
  const settingsError = useSettingsStore((state) => state.error);
  const phase = useExportStore((state) => state.phase);
  const problems = useExportStore((state) => state.problems);
  const error = useExportStore((state) => state.error);
  const exported = useExportStore((state) => state.exported);
  const concatenated = useExportStore((state) => state.concatenated);
  const setOptions = useSettingsStore((state) => state.setExportOptions);
  const run = useExportStore((state) => state.run);
  const reset = useExportStore((state) => state.reset);

  useEffect(() => {
    void useSettingsStore.getState().load();
  }, []);

  const chooseDestination = async () => {
    try {
      const folder = await ipc.pickFolder();
      if (folder) setOptions({ exportDestination: folder });
    } catch (error) {
      useSettingsStore
        .getState()
        .reportError(error instanceof Error ? error.message : String(error));
    }
  };

  // Fill in a default destination once, so a first export needs no dialog.
  useEffect(() => {
    if (!settingsLoaded || destination !== null) return;

    void ipc
      .defaultExportDir()
      .then((dir) => setOptions({ exportDestination: dir }))
      .catch((error: unknown) =>
        useSettingsStore
          .getState()
          .reportError(error instanceof Error ? error.message : String(error)),
      );
  }, [settingsLoaded, destination, setOptions]);

  const selected = useMemo(() => applyFilters(events, filters), [events, filters]);
  const filtered = isFilterActive(filters);

  const summary = matches.find((match) => match.id === currentMatch?.id);
  const video = videos.find((candidate) => candidate.id === activeVideoId);
  const sourcePath = video ? (video.playbackPath ?? video.path) : null;

  const preview = useMemo(() => {
    if (!summary || selected.length === 0) return null;
    return planNames(
      [
        {
          id: selected[0]?.id ?? 0,
          tag: selected[0]?.tagName ?? "",
          anchorMs: selected[0]?.anchorMs ?? 0,
        },
      ],
      template,
      {
        homeTeam: summary.homeTeam,
        awayTeam: summary.awayTeam,
        competition: summary.competition,
      },
    )[0]?.fileName;
  }, [selected, summary, template]);

  if (tools && (!tools.ffmpeg || !tools.ffprobe)) return <MissingTools />;

  if (!currentMatch) {
    return (
      <div className="space-y-2">
        <h2 className="text-title">Export</h2>
        <p className="text-body text-muted-foreground">Open a match to export clips from it.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-title">Export</h2>
        <p className="text-label text-muted-foreground">
          {selected.length} of {events.length} events
          {filtered ? " — a filter is limiting this" : ""}
        </p>
      </div>

      <div className="space-y-2">
        <Label>Save into</Label>
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-2 py-1 font-mono text-label">
            {destination ?? "No folder chosen"}
          </span>
          <Button variant="outline" size="sm" onClick={() => void chooseDestination()}>
            <FolderOpen className="size-3.5" aria-hidden="true" />
            Choose
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="export-template">File name</Label>
        <Input
          id="export-template"
          value={template}
          onChange={(event) => setOptions({ exportTemplate: event.currentTarget.value })}
          className="font-mono text-label"
        />
        <p className="text-caption text-muted-foreground">
          {AVAILABLE_PLACEHOLDERS.map((name) => `{${name}}`).join("  ")}
        </p>
        {preview && (
          <p className="truncate font-mono text-caption text-muted-foreground">{preview}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label>Cut</Label>
        <div className="flex gap-1">
          {(
            [
              { value: "fast", label: "Fast", hint: "Copies from the nearest keyframe" },
              { value: "accurate", label: "Accurate", hint: "Re-encodes, exact frames" },
            ] as const
          ).map((option) => (
            <Button
              key={option.value}
              variant={mode === option.value ? "default" : "outline"}
              size="sm"
              aria-pressed={mode === option.value}
              title={option.hint}
              onClick={() => setOptions({ exportMode: option.value })}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <p className="text-caption text-muted-foreground">
          {mode === "fast"
            ? "Seconds per clip, and the cut can start a moment early."
            : "Slower, and the cut lands exactly where the event does."}
        </p>
      </div>

      <div className="space-y-2">
        <Label>Extra padding around each clip</Label>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            aria-label="Extra seconds before"
            value={extraBeforeMs / 1000}
            onChange={(event) =>
              setOptions({
                exportExtraBeforeMs: Math.max(0, Number(event.currentTarget.value) * 1000),
              })
            }
            className="h-7 w-20 text-label"
          />
          <span className="text-label text-muted-foreground">seconds before</span>
          <Input
            type="number"
            aria-label="Extra seconds after"
            value={extraAfterMs / 1000}
            onChange={(event) =>
              setOptions({
                exportExtraAfterMs: Math.max(0, Number(event.currentTarget.value) * 1000),
              })
            }
            className="h-7 w-20 text-label"
          />
          <span className="text-label text-muted-foreground">after</span>
        </div>
      </div>

      <label className="flex items-center gap-2 text-body">
        <input
          type="checkbox"
          checked={concatenate}
          onChange={(event) => setOptions({ exportConcatenate: event.currentTarget.checked })}
          className="size-3.5 accent-[var(--primary)]"
        />
        Also join them into one file, in order
      </label>

      {problems.length > 0 && (
        <ul role="alert" className="space-y-1 rounded-lg border border-danger/40 bg-danger/10 p-2">
          {problems.map((problem) => (
            <li key={problem} className="text-label">
              {problem}
            </li>
          ))}
          <li className="text-label text-muted-foreground">
            Change the file name pattern or pick another folder — nothing is ever overwritten.
          </li>
        </ul>
      )}

      {settingsError && (
        <p
          role="alert"
          className="rounded-lg border border-warning/40 bg-warning/10 p-2 text-label"
        >
          Settings could not be saved: {settingsError}
        </p>
      )}

      {error && !problems.length && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-2 text-label">
          {error}
        </p>
      )}

      {phase === "running" ? (
        <Progress />
      ) : (
        <Button
          className="w-full"
          disabled={selected.length === 0}
          onClick={() =>
            void run({
              events: selected,
              context: {
                homeTeam: summary?.homeTeam ?? "Match",
                awayTeam: summary?.awayTeam ?? "",
                competition: summary?.competition ?? null,
              },
              durationMs: video?.durationMs ?? 0,
              sourcePath,
            })
          }
        >
          <SquareArrowOutUpRight className="size-4" aria-hidden="true" />
          Export {selected.length} clip{selected.length === 1 ? "" : "s"}
        </Button>
      )}

      {(exported.length > 0 || concatenated) && (
        <div className="space-y-2 rounded-lg border border-border bg-background p-3">
          <p className="flex items-center gap-1.5 text-body">
            <Check className="size-3.5 text-success" aria-hidden="true" />
            Wrote {exported.length} clip{exported.length === 1 ? "" : "s"}
            {concatenated ? " and one joined file" : ""}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void ipc.revealInFolder(concatenated ?? exported[0] ?? "")}
            >
              <FolderOpen className="size-3.5" aria-hidden="true" />
              Show in folder
            </Button>
            <Button variant="ghost" size="sm" onClick={reset}>
              <X className="size-3.5" aria-hidden="true" />
              Dismiss
            </Button>
          </div>
        </div>
      )}

      <p className={cn("text-caption text-muted-foreground", phase === "running" && "opacity-50")}>
        Clips are written one at a time, so a long match export stays responsive.
      </p>
    </div>
  );
}
