import { create } from "zustand";
import { listAnnotations, listAnnotationWindows } from "@/lib/db/queries/annotations";
import type { EventRow } from "@/lib/db/queries/events";
import {
  describeConflicts,
  type NamingContext,
  planNames,
  renderFilename,
} from "@/lib/export/filename";
import { buildOverlayPlan, enableExpression } from "@/lib/export/overlay";
import { type ExportMode, ipc } from "@/lib/ipc";
import { awaitJob } from "@/lib/jobs/jobEvents";
import { resolveWindow } from "@/lib/phases/rules";
import { renderOverlayPng } from "@/lib/render/burnIn";
import { usePhaseStore } from "@/stores/phaseStore";
import { useSettingsStore } from "@/stores/settingsStore";

/**
 * Running a clip export (FR-9).
 *
 * The queue lives here rather than in Rust because the sequencing is product
 * behaviour — order, padding, one job at a time, what to do on a conflict — while
 * Rust owns only the single FFmpeg run and its progress. The naming plan is
 * computed before anything is started, so a collision is reported instead of
 * discovered halfway through a batch.
 *
 * Preferences are not stored here: destination, pattern, cut mode and padding all
 * live in the settings store, which is what persists them across restarts.
 */

type ExportPhase = "idle" | "running" | "done" | "error";

type ExportState = {
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

  run: (input: {
    events: EventRow[];
    context: NamingContext;
    durationMs: number;
    sourcePath: string | null;
    /** The output video's pixel size, for rasterising the drawings (FR-40.1). */
    exportSize: { width: number; height: number };
  }) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
};

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
  ...IDLE,

  async run({ events, context, durationMs, sourcePath, exportSize }) {
    const {
      exportDestination: destination,
      exportTemplate: template,
      exportMode: mode,
      exportExtraBeforeMs: extraBeforeMs,
      exportExtraAfterMs: extraAfterMs,
      exportConcatenate: concatenate,
      exportAnnotations: burnIn,
      preRollMs,
      postRollMs,
    } = useSettingsStore.getState();

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
    if (burnIn && (exportSize.width <= 0 || exportSize.height <= 0)) {
      set({
        ...IDLE,
        phase: "error",
        error: "The video's size is not known yet, so its drawings cannot be rendered.",
      });
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

        // The window this event actually covers (D41): a phase is its own span, a
        // moment keeps the range it was captured with, and an action — which
        // stores the instant rather than a range — gets the pre-roll and post-roll
        // resolved here. Existing R0 events resolve to exactly their stored range,
        // so their clips are unchanged.
        const window = resolveWindow(
          {
            startMs: event.startMs,
            endMs: event.endMs,
            anchorMs: event.anchorMs,
            kind: usePhaseStore.getState().isPhase(event.tagId) ? "phase" : "event",
          },
          { preRollMs, postRollMs },
          durationMs,
        );
        const range = paddedRange(window, extraBeforeMs, extraAfterMs, durationMs);
        const output = joinPath(destination, item.fileName);
        set({ currentLabel: item.fileName, stepProgress: 0 });

        // The drawings are rasterised here, at the export resolution, by the
        // same renderer the preview uses. An event with no drawings produces no
        // overlays at all, so its clip is byte-for-byte what it was before.
        const overlays: { path: string; enable: string }[] = [];
        let effectiveMode: ExportMode = mode;

        if (burnIn) {
          // A drawing's own range is loaded in the same step (FR-20.16): without
          // it the burn-in would resolve the shape from the event's anchor and
          // put it somewhere the app never showed, which is the one thing the
          // overlay plan exists to prevent.
          const [rows, windows] = await Promise.all([
            listAnnotations(event.id),
            listAnnotationWindows(event.id),
          ]);
          const annotations = rows.map((row) => ({
            ...row,
            ownWindow: windows.get(row.id) ?? null,
          }));
          if (annotations.length > 0) {
            const plan = buildOverlayPlan(annotations, {
              anchorMs: event.anchorMs,
              // The resolved window, not the stored range: an action's drawings
              // belong to the clip the export is making, and a zero-length range
              // would collapse every `"event"` and `"clip"` window inside it.
              eventStartMs: window.startMs,
              eventEndMs: window.endMs,
              durationMs,
              clipStartMs: range.startMs,
              clipEndMs: range.endMs,
            });

            for (const [intervalIndex, interval] of plan.intervals.entries()) {
              const dataUrl = renderOverlayPng({
                annotations: interval.annotations,
                width: exportSize.width,
                height: exportSize.height,
              });
              const path = await ipc.writeOverlayPng(`clip-${event.id}-${intervalIndex}`, dataUrl);
              overlays.push({
                path,
                enable: enableExpression(interval.startMs, interval.endMs),
              });
            }

            // Overlaying is a filter, so the video stream cannot be copied (D22).
            if (overlays.length > 0) effectiveMode = "accurate";
          }
        }

        const job = await ipc.startExport(
          sourcePath,
          output,
          range.startMs,
          range.endMs,
          effectiveMode,
          overlays,
        );
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
