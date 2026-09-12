import { Film } from "lucide-react";
import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MatchList } from "@/features/library/MatchList";
import { MatchPanel } from "@/features/library/MatchPanel";
import { PlayerStage } from "@/features/player/PlayerStage";
import { TransportBar } from "@/features/player/TransportBar";
import { useTransportKeys } from "@/features/player/useTransportKeys";
import { MediaToolsNotice } from "@/features/settings/MediaToolsNotice";
import { TaxonomyPanel } from "@/features/taxonomy/TaxonomyPanel";
import { initializeDatabase } from "@/lib/db";
import { ipc } from "@/lib/ipc";
import { useLibraryStore } from "@/stores/libraryStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTagStore } from "@/stores/tagStore";

export function AppShell() {
  const hasVideo = useLibraryStore((state) => state.playbackUrl) !== null;
  const loadMatches = useLibraryStore((state) => state.loadMatches);
  const loadTags = useTagStore((state) => state.load);
  const setTools = useSettingsStore((state) => state.setTools);

  const [bootError, setBootError] = useState<string | null>(null);

  useTransportKeys(hasVideo);

  useEffect(() => {
    void ipc
      .checkMediaTools()
      .then(setTools)
      .catch(() => setTools({ ffmpeg: false, ffprobe: false, ffmpegVersion: null }));
  }, [setTools]);

  // Migrate, seed, then read. A failure here is shown, never swallowed.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        await initializeDatabase();
        if (cancelled) return;
        await Promise.all([loadMatches(), loadTags()]);
      } catch (error) {
        if (!cancelled) {
          setBootError(error instanceof Error ? error.message : String(error));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadMatches, loadTags]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Film className="size-5 text-primary" aria-hidden="true" />
        <h1 className="text-title tracking-tight">capball</h1>
        <span className="text-label text-muted-foreground">local-first match analysis</span>
      </header>

      <MediaToolsNotice />

      {bootError && (
        <p role="alert" className="border-b border-danger/40 bg-danger/10 px-4 py-3 text-body">
          The library could not be opened: {bootError}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-border bg-sidebar p-4">
          <MatchList />
        </aside>

        <main className="flex min-h-0 flex-1 flex-col">
          <PlayerStage />
          <TransportBar />
        </main>

        <aside className="w-96 shrink-0 overflow-y-auto border-l border-border bg-card p-4">
          <Tabs defaultValue="match">
            <TabsList className="w-full">
              <TabsTrigger value="match">Match</TabsTrigger>
              <TabsTrigger value="tags">Tags</TabsTrigger>
            </TabsList>
            <TabsContent value="match" className="pt-4">
              <MatchPanel />
            </TabsContent>
            <TabsContent value="tags" className="pt-4">
              <TaxonomyPanel />
            </TabsContent>
          </Tabs>
        </aside>
      </div>
    </div>
  );
}
