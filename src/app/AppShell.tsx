import { Film } from "lucide-react";
import { useEffect } from "react";
import { LibraryPanel } from "@/features/library/LibraryPanel";
import { PlayerStage } from "@/features/player/PlayerStage";
import { TransportBar } from "@/features/player/TransportBar";
import { useTransportKeys } from "@/features/player/useTransportKeys";
import { MediaToolsNotice } from "@/features/settings/MediaToolsNotice";
import { ipc } from "@/lib/ipc";
import { useLibraryStore } from "@/stores/libraryStore";
import { useSettingsStore } from "@/stores/settingsStore";

export function AppShell() {
  const hasVideo = useLibraryStore((state) => state.playbackUrl) !== null;
  const setTools = useSettingsStore((state) => state.setTools);

  useTransportKeys(hasVideo);

  useEffect(() => {
    void ipc
      .checkMediaTools()
      .then(setTools)
      .catch(() => setTools({ ffmpeg: false, ffprobe: false, ffmpegVersion: null }));
  }, [setTools]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Film className="size-5 text-primary" aria-hidden="true" />
        <h1 className="text-title tracking-tight">capball</h1>
        <span className="text-label text-muted-foreground">local-first match analysis</span>
      </header>

      <MediaToolsNotice />

      <div className="flex min-h-0 flex-1">
        <main className="flex min-h-0 flex-1 flex-col">
          <PlayerStage />
          <TransportBar />
        </main>

        <aside className="w-80 shrink-0 overflow-y-auto border-l border-border bg-card p-4">
          <LibraryPanel />
        </aside>
      </div>
    </div>
  );
}
