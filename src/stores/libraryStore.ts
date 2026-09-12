import { create } from "zustand";
import type { Match, MatchSummary } from "@/lib/db/queries/matches";
import * as matchesQuery from "@/lib/db/queries/matches";
import * as teamsQuery from "@/lib/db/queries/teams";
import type { Video } from "@/lib/db/queries/videos";
import * as videosQuery from "@/lib/db/queries/videos";
import { ipc, type MediaProbe } from "@/lib/ipc";
import { awaitJob } from "@/lib/jobs/jobEvents";
import { isIsoBmff, planPlayback } from "@/lib/media/playbackPlan";
import { probeFromVideo } from "@/lib/media/probeFromVideo";

export type PreparePhase = "idle" | "probing" | "preparing" | "missing" | "error";

type Progress = { outTimeMs: number; totalMs: number };

type LibraryState = {
  matches: MatchSummary[];
  currentMatchId: number | null;
  currentMatch: Match | null;
  videos: Video[];
  activeVideoId: number | null;
  probe: MediaProbe | null;
  playbackUrl: string | null;

  phase: PreparePhase;
  note: string | null;
  error: string | null;
  progress: Progress | null;
  activeJobId: string | null;

  loadMatches: () => Promise<void>;
  createMatch: (input: {
    homeTeam: string;
    awayTeam: string;
    competition?: string;
    kickoffAt?: number | null;
  }) => Promise<void>;
  openMatch: (id: number) => Promise<void>;
  closeMatch: () => void;
  removeMatch: (id: number) => Promise<void>;
  addVideoToCurrentMatch: () => Promise<void>;
  selectVideo: (id: number) => Promise<void>;
  removeVideo: (id: number) => Promise<void>;
  cancelPreparation: () => Promise<void>;
  clearError: () => void;
};

const IDLE = {
  phase: "idle" as PreparePhase,
  note: null,
  error: null,
  progress: null,
  activeJobId: null,
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  matches: [],
  currentMatchId: null,
  currentMatch: null,
  videos: [],
  activeVideoId: null,
  probe: null,
  playbackUrl: null,
  ...IDLE,

  async loadMatches() {
    try {
      set({ matches: await matchesQuery.listMatches() });
    } catch (error) {
      set({ ...IDLE, phase: "error", error: messageOf(error) });
    }
  },

  async createMatch(input) {
    try {
      const [home, away] = await Promise.all([
        teamsQuery.ensureTeam({ name: input.homeTeam }),
        teamsQuery.ensureTeam({ name: input.awayTeam }),
      ]);
      const id = await matchesQuery.createMatch({
        homeTeamId: home.id,
        awayTeamId: away.id,
        competition: input.competition ?? null,
        kickoffAt: input.kickoffAt ?? null,
      });
      await get().loadMatches();
      await get().openMatch(id);
    } catch (error) {
      set({ ...IDLE, phase: "error", error: messageOf(error) });
    }
  },

  async openMatch(id) {
    try {
      const match = await matchesQuery.getMatch(id);
      if (!match) throw new Error("That match is no longer in the library.");

      const videos = await videosQuery.listVideos(id);
      set({
        currentMatchId: id,
        currentMatch: match,
        videos,
        activeVideoId: null,
        probe: null,
        playbackUrl: null,
        ...IDLE,
      });

      if (videos[0]) await get().selectVideo(videos[0].id);
    } catch (error) {
      set({ ...IDLE, phase: "error", error: messageOf(error) });
    }
  },

  closeMatch() {
    set({
      currentMatchId: null,
      currentMatch: null,
      videos: [],
      activeVideoId: null,
      probe: null,
      playbackUrl: null,
      ...IDLE,
    });
  },

  async removeMatch(id) {
    try {
      await matchesQuery.deleteMatch(id);
      if (get().currentMatchId === id) get().closeMatch();
      await get().loadMatches();
    } catch (error) {
      set({ ...IDLE, phase: "error", error: messageOf(error) });
    }
  },

  /**
   * Import for the open match (FR-1): pick → probe → decide → prepare if needed
   * → store the row. A prepared copy is remembered, so reopening is instant.
   */
  async addVideoToCurrentMatch() {
    const matchId = get().currentMatchId;
    if (!matchId) {
      set({ ...IDLE, phase: "error", error: "Open a match before adding a video." });
      return;
    }

    const path = await ipc.pickVideoFile();
    if (!path) return;

    set({ ...IDLE, phase: "probing" });

    try {
      const status = await ipc.fileStatus(path);
      if (!status.exists) {
        set({ ...IDLE, phase: "missing", error: "That file could not be read. Choose it again." });
        return;
      }

      const probe = await ipc.probeMedia(path);
      const plan = planPlayback(probe);
      let playbackPath: string | null = null;

      if (plan.kind === "prepare") {
        set({ phase: "preparing", note: plan.reason });
        const job = await ipc.startMediaJob(path, plan.mode, probe.durationMs);
        set({ activeJobId: job.jobId || null });

        if (!job.reused && job.jobId) {
          const result = await awaitJob(job.jobId, (event) =>
            set({ progress: { outTimeMs: event.outTimeMs, totalMs: event.totalMs } }),
          );
          if (result.state !== "done") {
            set({
              ...IDLE,
              phase: "error",
              error:
                result.state === "cancelled"
                  ? "Preparation was cancelled."
                  : (result.message ?? "This video could not be prepared."),
            });
            return;
          }
        }
        playbackPath = job.output;
      }

      const video = await videosQuery.addVideo({
        matchId,
        path,
        fileName: path.split("/").pop() ?? path,
        playbackPath,
        sizeBytes: probe.sizeBytes,
        durationMs: probe.durationMs,
        width: probe.width,
        height: probe.height,
        fpsNum: probe.fpsNum,
        fpsDen: probe.fpsDen,
        videoCodec: probe.videoCodec,
        audioCodec: probe.audioCodec,
        container: probe.container,
        faststart: probe.faststart,
      });

      set({ videos: await videosQuery.listVideos(matchId), note: plan.reason });
      await get().selectVideo(video.id);
      await get().loadMatches();
    } catch (error) {
      set({ ...IDLE, phase: "error", error: messageOf(error) });
    }
  },

  /**
   * Opens a video for playback.
   *
   * Two things have to happen here rather than only at import: the asset scope
   * is granted per file and lasts only for the session, and a file imported
   * before it could be checked may still need preparing — most often an MP4
   * whose index sits at the end, which makes every seek slow.
   */
  async selectVideo(id) {
    let video = get().videos.find((candidate) => candidate.id === id);
    if (!video) return;

    try {
      const sourceStatus = await ipc.fileStatus(video.path);
      if (!sourceStatus.exists && !video.playbackPath) {
        set({
          ...IDLE,
          phase: "missing",
          activeVideoId: id,
          probe: probeFromVideo(video),
          playbackUrl: null,
          error: `${video.fileName} is not where it was. Import it again to relink it.`,
        });
        return;
      }

      // Rows stored before the index placement was recorded are checked once.
      if (video.faststart === null && !video.playbackPath && isIsoBmff(video.container)) {
        const probe = await ipc.probeMedia(video.path);
        await videosQuery.setVideoFaststart(video.id, probe.faststart);
        video = { ...video, faststart: probe.faststart };
        const updated = video;
        set((state) => ({
          videos: state.videos.map((candidate) =>
            candidate.id === updated.id ? updated : candidate,
          ),
        }));
      }

      if (!video.playbackPath) {
        const plan = planPlayback(probeFromVideo(video));
        if (plan.kind === "prepare") {
          set({ ...IDLE, phase: "preparing", note: plan.reason, activeVideoId: id });
          const job = await ipc.startMediaJob(video.path, plan.mode, video.durationMs);
          set({ activeJobId: job.jobId || null });

          if (!job.reused && job.jobId) {
            const result = await awaitJob(job.jobId, (event) =>
              set({ progress: { outTimeMs: event.outTimeMs, totalMs: event.totalMs } }),
            );
            if (result.state !== "done") {
              set({
                ...IDLE,
                phase: "error",
                activeVideoId: id,
                error:
                  result.state === "cancelled"
                    ? "Preparation was cancelled."
                    : (result.message ?? "This video could not be prepared."),
              });
              return;
            }
          }

          await videosQuery.setPlaybackPath(video.id, job.output);
          video = { ...video, playbackPath: job.output };
          const updated = video;
          set((state) => ({
            videos: state.videos.map((candidate) =>
              candidate.id === updated.id ? updated : candidate,
            ),
          }));
        }
      }

      const playable = video.playbackPath ?? video.path;
      const status = await ipc.fileStatus(playable);
      if (!status.exists) {
        set({
          ...IDLE,
          phase: "missing",
          activeVideoId: id,
          probe: probeFromVideo(video),
          playbackUrl: null,
          error: `${video.fileName} is not where it was. Import it again to relink it.`,
        });
        return;
      }

      await ipc.registerAssetPath(playable);
      set({
        ...IDLE,
        activeVideoId: id,
        probe: probeFromVideo(video),
        playbackUrl: ipc.assetUrl(playable),
      });
    } catch (error) {
      set({ ...IDLE, phase: "error", activeVideoId: id, error: messageOf(error) });
    }
  },

  async removeVideo(id) {
    const matchId = get().currentMatchId;
    try {
      await videosQuery.removeVideo(id);
      if (!matchId) return;

      const videos = await videosQuery.listVideos(matchId);
      set({ videos, activeVideoId: null, probe: null, playbackUrl: null, ...IDLE });
      if (videos[0]) await get().selectVideo(videos[0].id);
      await get().loadMatches();
    } catch (error) {
      set({ ...IDLE, phase: "error", error: messageOf(error) });
    }
  },

  async cancelPreparation() {
    const jobId = get().activeJobId;
    if (!jobId) return;
    await ipc.cancelJob(jobId);
  },

  clearError() {
    set({ ...IDLE });
  },
}));
