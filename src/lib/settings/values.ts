import { DEFAULT_TEMPLATE } from "@/lib/export/filename";
import type { ExportMode } from "@/lib/ipc";

/**
 * User preferences, persisted in the `settings` table as text.
 *
 * Decoding is deliberately defensive: a hand-edited or half-written database
 * must fall back to the default for that one value rather than break the app or
 * silently adopt nonsense such as a negative pre-roll.
 */

export type SettingsValues = {
  preRollMs: number;
  postRollMs: number;
  exportDestination: string | null;
  exportTemplate: string;
  exportMode: ExportMode;
  exportExtraBeforeMs: number;
  exportExtraAfterMs: number;
  exportConcatenate: boolean;
};

export const DEFAULT_SETTINGS: SettingsValues = {
  preRollMs: 8_000,
  postRollMs: 12_000,
  exportDestination: null,
  exportTemplate: DEFAULT_TEMPLATE,
  exportMode: "fast",
  exportExtraBeforeMs: 0,
  exportExtraAfterMs: 0,
  exportConcatenate: false,
};

/** Bumped only if the meaning of a stored value changes. */
export const SETTINGS_VERSION = 1;

function readMs(rows: Record<string, string>, key: string, fallback: number): number {
  const raw = rows[key];
  if (raw === undefined) return fallback;

  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback;
}

function readText(rows: Record<string, string>, key: string, fallback: string): string {
  const raw = rows[key];
  return raw !== undefined && raw.trim().length > 0 ? raw : fallback;
}

export function decodeSettings(rows: Record<string, string>): SettingsValues {
  const mode = rows.exportMode;

  return {
    preRollMs: readMs(rows, "preRollMs", DEFAULT_SETTINGS.preRollMs),
    postRollMs: readMs(rows, "postRollMs", DEFAULT_SETTINGS.postRollMs),
    exportDestination: readText(rows, "exportDestination", "") || null,
    exportTemplate: readText(rows, "exportTemplate", DEFAULT_SETTINGS.exportTemplate),
    exportMode: mode === "accurate" || mode === "fast" ? mode : DEFAULT_SETTINGS.exportMode,
    exportExtraBeforeMs: readMs(rows, "exportExtraBeforeMs", DEFAULT_SETTINGS.exportExtraBeforeMs),
    exportExtraAfterMs: readMs(rows, "exportExtraAfterMs", DEFAULT_SETTINGS.exportExtraAfterMs),
    exportConcatenate: rows.exportConcatenate === "true",
  };
}

export function encodeSettings(patch: Partial<SettingsValues>): Record<string, string> {
  const rows: Record<string, string> = {};

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    rows[key] = value === null ? "" : String(value);
  }

  return rows;
}
