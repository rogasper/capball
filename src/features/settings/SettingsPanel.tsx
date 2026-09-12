import { Download, FileJson, Loader2, RotateCcw, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLibraryStore } from "@/stores/libraryStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { exportMatchAnalysis, exportTaxonomy, importFile } from "./transfer";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-body">{label}</span>
      {children}
    </div>
  );
}

/** Settings (FR-11): capture defaults, data, and where things are. */
export function SettingsPanel() {
  const preRollMs = useSettingsStore((state) => state.preRollMs);
  const postRollMs = useSettingsStore((state) => state.postRollMs);
  const loaded = useSettingsStore((state) => state.loaded);
  const error = useSettingsStore((state) => state.error);
  const setPreRollMs = useSettingsStore((state) => state.setPreRollMs);
  const setPostRollMs = useSettingsStore((state) => state.setPostRollMs);
  const reset = useSettingsStore((state) => state.reset);
  const clearError = useSettingsStore((state) => state.clearError);
  const tools = useSettingsStore((state) => state.tools);

  const currentMatchId = useLibraryStore((state) => state.currentMatchId);

  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [transferError, setTransferError] = useState<string | null>(null);

  useEffect(() => {
    void useSettingsStore.getState().load();
  }, []);

  const run = async (label: string, action: () => Promise<string | null | undefined>) => {
    setBusy(label);
    setTransferError(null);
    setNotes([]);
    try {
      const result = await action();
      if (typeof result === "string") setMessage(result);
    } catch (caught) {
      setTransferError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };

  const importNow = () =>
    run("import", async () => {
      const report = await importFile();
      if (!report) return null;
      setNotes(report.notes);
      return report.message;
    });

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-title">Settings</h2>
        <p className="text-label text-muted-foreground">
          Saved with your library, so they survive a restart.
        </p>
      </div>

      {!loaded ? (
        <p className="flex items-center gap-2 text-label text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Reading your settings…
        </p>
      ) : (
        <>
          <section className="space-y-2">
            <h3 className="text-label text-muted-foreground">Capture</h3>
            <Row label="Default pre-roll">
              <span className="flex items-center gap-1">
                <Input
                  type="number"
                  aria-label="Default pre-roll in seconds"
                  value={preRollMs / 1000}
                  onChange={(event) =>
                    setPreRollMs(Math.max(0, Number(event.currentTarget.value) * 1000))
                  }
                  className="h-7 w-20 text-label"
                />
                <span className="text-label text-muted-foreground">seconds before</span>
              </span>
            </Row>
            <Row label="Default post-roll">
              <span className="flex items-center gap-1">
                <Input
                  type="number"
                  aria-label="Default post-roll in seconds"
                  value={postRollMs / 1000}
                  onChange={(event) =>
                    setPostRollMs(Math.max(0, Number(event.currentTarget.value) * 1000))
                  }
                  className="h-7 w-20 text-label"
                />
                <span className="text-label text-muted-foreground">seconds after</span>
              </span>
            </Row>
            <p className="text-caption text-muted-foreground">
              New captures use these; events already tagged keep the range they were given.
            </p>
          </section>

          <section className="space-y-2 border-t border-border pt-4">
            <h3 className="text-label text-muted-foreground">Your data</h3>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null || currentMatchId === null}
                onClick={() =>
                  void run("match", () => exportMatchAnalysis(currentMatchId as number))
                }
              >
                <FileJson className="size-3.5" aria-hidden="true" />
                Export this match
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => void run("taxonomy", exportTaxonomy)}
              >
                <Download className="size-3.5" aria-hidden="true" />
                Export taxonomy
              </Button>
              <Button variant="outline" size="sm" disabled={busy !== null} onClick={importNow}>
                <Upload className="size-3.5" aria-hidden="true" />
                Import a file
              </Button>
            </div>
            <p className="text-caption text-muted-foreground">
              Importing never overwrites: existing teams and tags are reused, and the same file
              twice adds nothing.
            </p>

            {message && <p className="text-label text-success">{message}</p>}
            {notes.length > 0 && (
              <ul className="space-y-0.5 text-caption text-muted-foreground">
                {notes.slice(0, 6).map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
            {transferError && (
              <p role="alert" className="text-label text-danger">
                {transferError}
              </p>
            )}
          </section>

          <section className="space-y-2 border-t border-border pt-4">
            <h3 className="text-label text-muted-foreground">Media tools</h3>
            <p className="text-label">
              {tools?.ffmpeg
                ? (tools.ffmpegVersion ?? "FFmpeg is installed.")
                : "FFmpeg was not found. Import and tagging still work; preparing and exporting need it."}
            </p>
          </section>

          <section className="border-t border-border pt-4">
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw className="size-3.5" aria-hidden="true" />
              Restore defaults
            </Button>
          </section>

          {error && (
            <p role="alert" className="flex items-center gap-2 text-label text-warning">
              {error}
              <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={clearError}>
                ×
              </Button>
            </p>
          )}
        </>
      )}
    </div>
  );
}
