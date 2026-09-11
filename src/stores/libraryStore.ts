import { create } from "zustand";
import { ipc, type MediaProbe } from "@/lib/ipc";
import { awaitJob } from "@/lib/jobs/jobEvents";
import { planPlayback } from "@/lib/media/playbackPlan";

export type LibraryPhase = "empty" | "probing" | "preparing" | "ready" | "missing" | "error";

type Progress = { outTimeMs: number; totalMs: number };

type LibraryState = {
  phase: LibraryPhase;
  sourcePath: string | null;
  probe: MediaProbe | null;
  playbackUrl: string | null;
  /** Why the file is being prepared, or why it played directly. */
  note: string | null;
  error: string | null;
  progress: Progress | null;
  activeJobId: string | null;

  importVideo: () => Promise<void>;
  cancelPreparation: () => Promise<void>;
  reset: () => void;
};

const INITIAL = {
  phase: "empty" as LibraryPhase,
  sourcePath: null,
  probe: null,
  playbackUrl: null,
  note: null,
  error: null,
  progress: null,
  activeJobId: null,
};

export const useLibraryStore = create<LibraryState>((set, get) => ({
  ...INITIAL,

  /**
   * Import flow (FR-1): pick → probe → decide → play, or prepare first.
   *
   * M1 keeps the imported video in memory only; persistence arrives with the
   * database in M2.
   */
  async importVideo() {
    const path = await ipc.pickVideoFile();
    if (!path) return;

    set({ ...INITIAL, phase: "probing", sourcePath: path });

    try {
      const status = await ipc.fileStatus(path);
      if (!status.exists) {
        set({ phase: "missing", error: "That file is no longer where it was. Choose it again." });
        return;
      }

      const probe = await ipc.probeMedia(path);
      set({ probe });

      const plan = planPlayback(probe);

      if (plan.kind === "direct") {
        await ipc.registerAssetPath(path);
        set({ phase: "ready", playbackUrl: ipc.assetUrl(path), note: plan.reason });
        return;
      }

      set({ phase: "preparing", note: plan.reason });
      const job = await ipc.startMediaJob(path, plan.mode, probe.durationMs);
      set({ activeJobId: job.jobId || null });

      if (!job.reused && job.jobId) {
        const result = await awaitJob(job.jobId, (event) =>
          set({ progress: { outTimeMs: event.outTimeMs, totalMs: event.totalMs } }),
        );

        if (result.state !== "done") {
          set({
            phase: "error",
            activeJobId: null,
            progress: null,
            error:
              result.state === "cancelled"
                ? "Preparation was cancelled."
                : (result.message ?? "The video could not be prepared."),
          });
          return;
        }
      }

      // The prepared file lives in the app cache directory, which is also
      // outside the asset scope until we register it.
      await ipc.registerAssetPath(job.output);
      set({
        phase: "ready",
        playbackUrl: ipc.assetUrl(job.output),
        progress: null,
        activeJobId: null,
      });
    } catch (error) {
      set({
        phase: "error",
        progress: null,
        activeJobId: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  async cancelPreparation() {
    const jobId = get().activeJobId;
    if (!jobId) return;
    await ipc.cancelJob(jobId);
  },

  reset() {
    set(INITIAL);
  },
}));
