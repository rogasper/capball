import { type AnnotationStyle, DEFAULT_STYLE, normaliseStyle } from "@/lib/annotate/types";
import { DEFAULT_TEMPLATE } from "@/lib/export/filename";
import type { ExportMode } from "@/lib/ipc";
import { DEFAULT_PITCH_LENGTH_M, DEFAULT_PITCH_WIDTH_M } from "@/lib/pitch/pitchModel";

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
  /**
   * Burn the drawings into exported clips (FR-40.1). Off by default, because it
   * forces a re-encode — an annotated clip costs what an accurate one costs.
   */
  exportAnnotations: boolean;
  /**
   * Include the pitch as an inset in exported clips (FR-40.2). Off by default,
   * like the burn-in, because carrying it means re-encoding the picture.
   */
  exportPitchInset: boolean;
  /** How long a new shape is on screen by default (FR-20.4). */
  annotationWindowMs: number;
  /** Pitch dimensions, because they change what a stored metre means (FR-30.1). */
  pitchLengthM: number;
  pitchWidthM: number;
  /** The style a new shape starts from, so arrows are not restyled one by one. */
  annotationStyle: AnnotationStyle;
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
  exportAnnotations: false,
  exportPitchInset: false,
  annotationWindowMs: 2_500,
  annotationStyle: { ...DEFAULT_STYLE },
  pitchLengthM: DEFAULT_PITCH_LENGTH_M,
  pitchWidthM: DEFAULT_PITCH_WIDTH_M,
};

/** Bumped only if the meaning of a stored value changes. */
export const SETTINGS_VERSION = 1;

const HEX_COLOUR = /^#[0-9a-fA-F]{3,8}$/;

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

/** A dimension in metres: positive and finite, or the default. */
function readMetres(rows: Record<string, string>, key: string, fallback: number): number {
  const value = Number(rows[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readUnit(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function readColour(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX_COLOUR.test(value) ? value : fallback;
}

/**
 * A stored style, merged over the default one field at a time, so a single bad
 * value does not discard the rest of a user's chosen style.
 */
function readStyle(
  rows: Record<string, string>,
  key: string,
  fallback: AnnotationStyle,
): AnnotationStyle {
  const raw = rows[key];
  if (raw === undefined) return { ...fallback };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...fallback };
  }
  if (typeof parsed !== "object" || parsed === null) return { ...fallback };

  const candidate = parsed as Partial<AnnotationStyle>;
  // Through `normaliseStyle`, so a stored style without the R2 pattern fields
  // keeps rendering as solid instead of reaching the renderer as undefined.
  return normaliseStyle({
    stroke: readColour(candidate.stroke, fallback.stroke),
    fill: candidate.fill === null ? null : readColour(candidate.fill, fallback.fill ?? "#FFFFFF"),
    width: readUnit(candidate.width, fallback.width),
    fontSize: readUnit(candidate.fontSize, fallback.fontSize),
    opacity:
      typeof candidate.opacity === "number" && candidate.opacity >= 0 && candidate.opacity <= 1
        ? candidate.opacity
        : fallback.opacity,
    fillPattern: candidate.fillPattern,
    patternScale: candidate.patternScale,
    patternAngle: candidate.patternAngle,
  });
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
    exportAnnotations: rows.exportAnnotations === "true",
    exportPitchInset: rows.exportPitchInset === "true",
    annotationWindowMs: readMs(rows, "annotationWindowMs", DEFAULT_SETTINGS.annotationWindowMs),
    annotationStyle: readStyle(rows, "annotationStyle", DEFAULT_SETTINGS.annotationStyle),
    pitchLengthM: readMetres(rows, "pitchLengthM", DEFAULT_SETTINGS.pitchLengthM),
    pitchWidthM: readMetres(rows, "pitchWidthM", DEFAULT_SETTINGS.pitchWidthM),
  };
}

export function encodeSettings(patch: Partial<SettingsValues>): Record<string, string> {
  const rows: Record<string, string> = {};

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) rows[key] = "";
    else if (typeof value === "object") rows[key] = JSON.stringify(value);
    else rows[key] = String(value);
  }

  return rows;
}
