import { create } from "zustand";
import * as settingsQuery from "@/lib/db/queries/settings";
import type { ToolStatus } from "@/lib/ipc";
import {
  DEFAULT_SETTINGS,
  decodeSettings,
  encodeSettings,
  type SettingsValues,
} from "@/lib/settings/values";

/**
 * The single owner of user preferences (FR-11).
 *
 * Everything here is persisted, so a default survives a restart; the export
 * panel and the capture engine both read from this rather than keeping their own
 * copies of the same numbers.
 */

type ExportOptions = Pick<
  SettingsValues,
  | "exportDestination"
  | "exportTemplate"
  | "exportMode"
  | "exportExtraBeforeMs"
  | "exportExtraAfterMs"
  | "exportConcatenate"
  | "exportAnnotations"
  | "exportPitchInset"
>;

type AnnotationDefaults = Pick<SettingsValues, "annotationWindowMs" | "annotationStyle">;

type SettingsState = SettingsValues & {
  tools: ToolStatus | null;
  loaded: boolean;
  error: string | null;
  /** What the last cache cleanup did, or why it could not run (NFR-22). */
  cacheNote: string | null;
  cacheError: string | null;

  load: () => Promise<void>;
  setPreRollMs: (ms: number) => void;
  setPostRollMs: (ms: number) => void;
  setExportOptions: (patch: Partial<ExportOptions>) => void;
  setAnnotationDefaults: (patch: Partial<AnnotationDefaults>) => void;
  reset: () => void;
  setTools: (tools: ToolStatus) => void;
  reportCache: (note: string) => void;
  reportCacheError: (message: string) => void;
  reportError: (message: string) => void;
  clearError: () => void;
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const useSettingsStore = create<SettingsState>((set) => {
  /** Applies a change and writes it; a failed write is visible, never swallowed. */
  const persist = (patch: Partial<SettingsValues>) => {
    set(patch);
    void settingsQuery
      .writeSettings(encodeSettings(patch))
      .catch((error) => set({ error: messageOf(error) }));
  };

  return {
    ...DEFAULT_SETTINGS,
    tools: null,
    loaded: false,
    error: null,
    cacheNote: null,
    cacheError: null,

    async load() {
      try {
        const rows = await settingsQuery.readSettings();
        set({ ...decodeSettings(rows), loaded: true });
      } catch (error) {
        // Defaults are still usable, so say what happened and carry on.
        set({ ...DEFAULT_SETTINGS, loaded: true, error: messageOf(error) });
      }
    },

    setPreRollMs(ms) {
      persist({ preRollMs: Math.max(0, Math.round(ms)) });
    },

    setPostRollMs(ms) {
      persist({ postRollMs: Math.max(0, Math.round(ms)) });
    },

    setExportOptions(patch) {
      const next: Partial<SettingsValues> = { ...patch };
      if (patch.exportExtraBeforeMs !== undefined) {
        next.exportExtraBeforeMs = Math.max(0, Math.round(patch.exportExtraBeforeMs));
      }
      if (patch.exportExtraAfterMs !== undefined) {
        next.exportExtraAfterMs = Math.max(0, Math.round(patch.exportExtraAfterMs));
      }
      persist(next);
    },

    setAnnotationDefaults(patch) {
      const next: Partial<AnnotationDefaults> = { ...patch };
      if (patch.annotationWindowMs !== undefined) {
        next.annotationWindowMs = Math.max(0, Math.round(patch.annotationWindowMs));
      }
      persist(next);
    },

    reset() {
      persist(DEFAULT_SETTINGS);
    },

    setTools(tools) {
      set({ tools });
    },

    reportCache(note) {
      set({ cacheNote: note, cacheError: null });
    },

    reportCacheError(message) {
      set({ cacheError: message });
    },

    reportError(message) {
      set({ error: message });
    },

    clearError() {
      set({ error: null });
    },
  };
});
