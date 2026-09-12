import { create } from "zustand";
import type { EventRow } from "@/lib/db/queries/events";
import {
  DEFAULT_TEMPLATE,
  describeConflicts,
  type NamingContext,
  planNames,
  renderFilename,
} from "@/lib/export/filename";
import { type ExportMode, ipc } from "@/lib/ipc";
import { awaitJob } from "@/lib/jobs/jobEvents";

/**
 * Clip export (FR-9).
 *
 * The queue lives here rather than in Rust because the sequencing is product
 * behaviour — order, padding, one job at a time, what to do on conflict — while
 * Rust owns only the single FFmpeg run and its progress. The naming plan is
 * computed before anything is started, so a collision is reported instead of
 * discovered halfway through a batch.
 */

type ExportPhase = "idle" | "running" | "done" | "error";

type ExportState = {
  destination: string | null;
  template: string;
  mode: ExportMode;
  /** Padding added on top of each event's own range, per export (FR-9.3). */
  extraBeforeMs: number;
  extraAfterMs: number;
  concatenate: boolean;

  phase: ExportPhase;
  totalSteps: number;
  completedSteps: number;
  stepProgress: number;
  currentLabel: string | null;
  exported: string[];
  concatenated: string | null;
  problems: string[];
  error: string | null;
  activeJobId: string | null;

  setOptions: (patch: Partial<ExportOptions>) => void;
  initialize: () => Promise<void>;
  chooseDestination: () => Promise<void>;
  run: (input: {
    events: EventRow[];
    context: NamingContext;
    durationMs: number;
    sourcePath: string | null;
  }) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
};

type ExportOptions = Pick<
  ExportState,
  "destination" | "template" | "mode" | "extraBeforeMs" | "extraAfterMs" | "concatenate"
>;

const IDLE = {
  phase: "idle" as ExportPhase,
  totalSteps: 0,
  completedSteps: 0,
  stepProgress: 0,
  currentLabel: null,
  exported: [],
  concatenated: null,
  problems: [],
  error: null,
  activeJobId: null,
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function joinPath(folder: string, fileName: string): string {
  return `${folder.replace(/\/+$/, "")}/${fileName}`;
}

/** Extends an event's own range by the requested padding, inside the video. */
export function paddedRange(
  event: { startMs: number; endMs: number },
  extraBeforeMs: number,
  extraAfterMs: number,
  durationMs: number,
): { startMs: number; endMs: number } {
  const startMs = Math.max(0, Math.round(event.startMs - extraBeforeMs));
  const endMs = Math.min(
    durationMs > 0 ? durationMs : Number.MAX_SAFE_INTEGER,
    event.endMs + extraAfterMs,
  );
  return { startMs, endMs: Math.max(startMs, Math.round(endMs)) };
}

export const useExportStore = create<ExportState>((set, get) => ({
  destination: null,
  template: DEFAULT_TEMPLATE,
  mode: "fast",
  extraBeforeMs: 0,
  extraAfterMs: 0,
  concatenate: false,
  ...IDLE,

  setOptions(patch) {
    set(patch);
  },

  /** Fills in the default destination once, so exporting needs no dialog. */
  async initialize() {
    if (get().destination !== null) return;
    try {
      set({ destination: await ipc.defaultExportDir() });
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  async chooseDestination() {
    const folder = await ipc.pickFolder();
    if (folder) set({ destination: folder });
  },

  async run({ events, context, durationMs, sourcePath }) {
    const { destination, template, mode, extraBeforeMs, extraAfterMs, concatenate } = get();

    if (!sourcePath) {
      set({ ...IDLE, phase: "error", error: "Import a video before exporting." });
      return;
    }
    if (!destination) {
      set({ ...IDLE, phase: "error", error: "Choose a folder to save the clips into." });
      return;
    }
    if (events.length === 0) {
      set({ ...IDLE, phase: "error", error: "Select at least one event to export." });
      return;
    }

    set({ ...IDLE, phase: "running" });

    try {
      // Plan every name first, so a collision is a message rather than a
      // half-finished batch.
      const ordered = [...events].sort((a, b) => a.anchorMs - b.anchorMs);
      const planned = planNames(
        ordered.map((event) => ({ id: event.id, tag: event.tagName, anchorMs: event.anchorMs })),
        template,
        context,
      );

      const names = planned.map((item) => item.fileName);
      const joined = concatenate
        ? renderFilename(
            template,
            context,
            { id: -1, tag: "all", anchorMs: ordered[0]?.anchorMs ?? 0 },
            1,
          )
        : null;
      if (joined) names.push(joined);

      const existing = new Set<string>();
      for (const name of names) {
        const status = await ipc.fileStatus(joinPath(destination, name));
        if (status.exists) existing.add(name);
      }

      const problems = describeConflicts(planned, existing);
      if (joined && existing.has(joined)) {
        problems.push(`${joined} already exists in that folder.`);
      }
      if (problems.length > 0) {
        set({
          ...IDLE,
          phase: "error",
          problems,
          error: problems[0] ?? "Those files already exist.",
        });
        return;
      }

      const totalSteps = planned.length + (joined ? 1 : 0);
      set({ totalSteps, completedSteps: 0, stepProgress: 0 });

      const clipPaths: string[] = [];
      let exportedDurationMs = 0;

      for (const [index, item] of planned.entries()) {
        const event = ordered[index];
        if (!event) continue;

        const range = paddedRange(event, extraBeforeMs, extraAfterMs, durationMs);
        const output = joinPath(destination, item.fileName);
        set({ currentLabel: item.fileName, stepProgress: 0 });

        const job = await ipc.startExport(sourcePath, output, range.startMs, range.endMs, mode);
        set({ activeJobId: job.jobId });

        const result = await awaitJob(job.jobId, (progress) =>
          set({ stepProgress: progress.totalMs > 0 ? progress.outTimeMs / progress.totalMs : 0 }),
        );
        if (result.state !== "done") {
          set({
            phase: result.state === "cancelled" ? "idle" : "error",
            activeJobId: null,
            currentLabel: null,
            error:
              result.state === "cancelled"
                ? null
                : (result.message ?? `Could not export ${item.fileName}.`),
            exported: get().exported,
          });
          return;
        }

        clipPaths.push(output);
        exportedDurationMs += range.endMs - range.startMs;
        set((state) => ({
          exported: [...state.exported, output],
          completedSteps: index + 1,
          stepProgress: 0,
        }));
      }

      if (joined) {
        const output = joinPath(destination, joined);
        set({ currentLabel: joined, stepProgress: 0 });

        const job = await ipc.startConcat(clipPaths, output, exportedDurationMs);
        set({ activeJobId: job.jobId });

        const result = await awaitJob(job.jobId, (progress) =>
          set({ stepProgress: progress.totalMs > 0 ? progress.outTimeMs / progress.totalMs : 0 }),
        );
        if (result.state !== "done") {
          set({
            phase: result.state === "cancelled" ? "idle" : "error",
            activeJobId: null,
            currentLabel: null,
            error:
              result.state === "cancelled"
                ? null
                : (result.message ?? "The clips were exported but could not be joined."),
          });
          return;
        }

        set({ concatenated: output, completedSteps: get().totalSteps, stepProgress: 0 });
      }

      set({ phase: "done", activeJobId: null, currentLabel: null });
    } catch (error) {
      set({ ...IDLE, phase: "error", error: messageOf(error) });
    }
  },

  async cancel() {
    const jobId = get().activeJobId;
    if (jobId) await ipc.cancelJob(jobId);
  },

  reset() {
    set({ ...IDLE });
  },
}));
