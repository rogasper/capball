import { Film } from "lucide-react";
import { useEffect, useState } from "react";
import { ScrollingTabsList } from "@/components/scrolling-tabs";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { AnnotationPanel } from "@/features/annotate/AnnotationPanel";
import { useAnnotationShortcuts } from "@/features/annotate/useAnnotationShortcuts";
import { EventList } from "@/features/events/EventList";
import { ExportPanel } from "@/features/export/ExportPanel";
import { MatchList } from "@/features/library/MatchList";
import { MatchPanel } from "@/features/library/MatchPanel";
import { PitchPanel } from "@/features/pitch/PitchPanel";
import { PlayerStage } from "@/features/player/PlayerStage";
import { TransportBar } from "@/features/player/TransportBar";
import { useTransportKeys } from "@/features/player/useTransportKeys";
import { useReviewRunner } from "@/features/review/useReviewRunner";
import { MediaToolsNotice } from "@/features/settings/MediaToolsNotice";
import { SettingsPanel } from "@/features/settings/SettingsPanel";
import { ActiveContext } from "@/features/tagging/ActiveContext";
import { CaptureStatus } from "@/features/tagging/CaptureStatus";
import { useCaptureKeys } from "@/features/tagging/useCaptureKeys";
import { TaxonomyPanel } from "@/features/taxonomy/TaxonomyPanel";
import { Timeline } from "@/features/timeline/Timeline";
import { initializeDatabase } from "@/lib/db";
import { ipc } from "@/lib/ipc";
import { describeCacheReport, pruneCaches } from "@/lib/media/cache";
import { useAnnotationStore } from "@/stores/annotationStore";
import { useCalibrationStore } from "@/stores/calibrationStore";
import { useEventStore } from "@/stores/eventStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useMagnifierStore } from "@/stores/magnifierStore";
import { usePositionStore } from "@/stores/positionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useSquadStore } from "@/stores/squadStore";
import { useTagStore } from "@/stores/tagStore";

export function AppShell() {
  const hasVideo = useLibraryStore((state) => state.playbackUrl) !== null;
  const currentMatchId = useLibraryStore((state) => state.currentMatchId);
  const activeVideoId = useLibraryStore((state) => state.activeVideoId);
  const selectedEventId = useAnnotationStore((state) => state.eventId);
  const homeTeamId = useLibraryStore((state) => state.currentMatch?.homeTeamId);
  const awayTeamId = useLibraryStore((state) => state.currentMatch?.awayTeamId);

  const loadMatches = useLibraryStore((state) => state.loadMatches);
  const loadTags = useTagStore((state) => state.load);
  const loadEvents = useEventStore((state) => state.load);
  const clearEvents = useEventStore((state) => state.clear);
  const loadSquads = useSquadStore((state) => state.load);
  const setTools = useSettingsStore((state) => state.setTools);

  const [bootError, setBootError] = useState<string | null>(null);

  useTransportKeys(hasVideo);
  useCaptureKeys(hasVideo);
  useAnnotationShortcuts();
  useReviewRunner();

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
        if (cancelled) return;

        // The cache policy runs once per launch, after the library is known, so
        // it knows which derived files are still referenced. A failure is
        // recorded where Settings can show it rather than swallowed.
        void pruneCaches()
          .then((report) => {
            if (!cancelled) useSettingsStore.getState().reportCache(describeCacheReport(report));
          })
          .catch((error: unknown) => {
            if (!cancelled) {
              useSettingsStore
                .getState()
                .reportCacheError(error instanceof Error ? error.message : String(error));
            }
          });
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

  // Events belong to the open match, so they are reloaded when it changes.
  useEffect(() => {
    useAnnotationStore.getState().clear();
    if (currentMatchId === null) {
      clearEvents();
      return;
    }
    void loadEvents(currentMatchId);
  }, [currentMatchId, loadEvents, clearEvents]);

  // Calibrations belong to a video. Read the pitch size on demand rather than
  // subscribing, so editing it in the panel does not restart the flow and throw
  // away the points already picked.
  useEffect(() => {
    // A magnified view belongs to the frame it was opened on, so changing the
    // video closes it rather than showing the new footage at the old moment.
    useMagnifierStore.getState().close();
    const calibrations = useCalibrationStore.getState();
    if (activeVideoId === null) {
      calibrations.clear();
      return;
    }
    const settings = useSettingsStore.getState();
    void calibrations.load(activeVideoId, {
      lengthM: settings.pitchLengthM,
      widthM: settings.pitchWidthM,
    });
  }, [activeVideoId]);

  // Positions belong to the event the drawing panel has open, so they follow it.
  useEffect(() => {
    const positions = usePositionStore.getState();
    if (selectedEventId === null) {
      positions.clear();
      return;
    }
    void positions.load(selectedEventId);
  }, [selectedEventId]);

  // Squads are loaded here so the tagging context always has both rosters.
  useEffect(() => {
    if (homeTeamId === undefined || awayTeamId === undefined) return;
    void loadSquads([homeTeamId, awayTeamId]);
  }, [loadSquads, homeTeamId, awayTeamId]);

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
          <ActiveContext />
          <Timeline />
          <CaptureStatus />
          <TransportBar />
        </main>

        <aside className="w-96 shrink-0 overflow-y-auto border-l border-border bg-card p-4">
          {/*
            `activationMode="manual"`: the arrow keys move focus along the tab row
            but do not select, because they are also the transport's seek keys.
            Automatic activation meant a seek switched the panel (2026-09-14).
          */}
          <Tabs defaultValue="events" activationMode="manual">
            {/* Each tab is as wide as its own label, and the row scrolls when
                they do not fit — with a chevron when something is hidden. */}
            <ScrollingTabsList>
              <TabsTrigger value="events" className="flex-none px-2.5">
                Events
              </TabsTrigger>
              <TabsTrigger value="match" className="flex-none px-2.5">
                Match
              </TabsTrigger>
              <TabsTrigger value="tags" className="flex-none px-2.5">
                Tags
              </TabsTrigger>
              <TabsTrigger value="draw" className="flex-none px-2.5">
                Draw
              </TabsTrigger>
              <TabsTrigger value="pitch" className="flex-none px-2.5">
                Pitch
              </TabsTrigger>
              <TabsTrigger value="export" className="flex-none px-2.5">
                Export
              </TabsTrigger>
              <TabsTrigger value="settings" className="flex-none px-2.5">
                Settings
              </TabsTrigger>
            </ScrollingTabsList>
            <TabsContent value="events" className="pt-4">
              <EventList />
            </TabsContent>
            <TabsContent value="match" className="pt-4">
              <MatchPanel />
            </TabsContent>
            <TabsContent value="tags" className="pt-4">
              <TaxonomyPanel />
            </TabsContent>
            <TabsContent value="draw" className="pt-4">
              <AnnotationPanel />
            </TabsContent>
            <TabsContent value="pitch" className="pt-4">
              <PitchPanel />
            </TabsContent>
            <TabsContent value="export" className="pt-4">
              <ExportPanel />
            </TabsContent>
            <TabsContent value="settings" className="pt-4">
              <SettingsPanel />
            </TabsContent>
          </Tabs>
        </aside>
      </div>
    </div>
  );
}
