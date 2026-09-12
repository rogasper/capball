import { create } from "zustand";
import type { StoredCalibration } from "@/lib/db/queries/calibrations";
import * as calibrationsQuery from "@/lib/db/queries/calibrations";
import { resolveCalibration, solveHomography } from "@/lib/pitch/homography";
import {
  DEFAULT_PITCH_LENGTH_M,
  DEFAULT_PITCH_WIDTH_M,
  findFeature,
  type PitchSize,
  RECOMMENDED_FEATURE_KEYS,
} from "@/lib/pitch/pitchModel";
import type { Correspondence, SolveOutcome } from "@/lib/pitch/types";

/**
 * The calibration flow (FR-30.1, FR-30.2).
 *
 * The store holds the picks; the solve is derived from them by a pure function,
 * so what the panel shows and what the overlay draws come from one computation.
 * Reference points are stored in normalised frame coordinates like every other
 * coordinate in the app, and converted to pixels only for the solve — which is
 * where the error is measured.
 */

export type Pick = {
  feature: string;
  imageU: number;
  imageV: number;
  xM: number;
  yM: number;
};

export type CalibrationPhase = "idle" | "picking" | "ready";

type CalibrationState = {
  videoId: number | null;
  calibrations: StoredCalibration[];
  /** The reference points being assembled. */
  picks: Pick[];
  fromMs: number;
  pitchLengthM: number;
  pitchWidthM: number;
  /** The feature waiting for a click, or null when not picking. */
  pendingFeature: string | null;
  /** The stored calibration being reworked, if any. */
  editingId: number | null;
  error: string | null;

  load: (videoId: number, size?: PitchSize) => Promise<void>;
  clear: () => void;
  startPicking: (featureKey: string | null) => void;
  addPick: (imageU: number, imageV: number) => Promise<void>;
  removePick: (featureKey: string) => void;
  clearPicks: () => void;
  setFromMs: (ms: number) => void;
  setPitchSize: (size: PitchSize) => void;
  edit: (id: number) => void;
  save: (frame: { width: number; height: number }) => Promise<boolean>;
  remove: (id: number) => Promise<void>;
  reportError: (message: string) => void;
  clearError: () => void;
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The next feature the flow should offer, so the picks stay well spread. */
export function nextRecommended(usedFeatures: string[]): string | null {
  return RECOMMENDED_FEATURE_KEYS.find((key) => !usedFeatures.includes(key)) ?? null;
}

/**
 * The solve for a set of picks.
 *
 * Pure and exported so the panel, the overlay and the tests all see the same
 * answer. Points are normalised in storage and pixels in the solve, because the
 * reprojection error is reported in video pixels.
 */
export function solvePicks(
  picks: Pick[],
  frame: { width: number; height: number },
): SolveOutcome | null {
  if (picks.length === 0) return null;

  const points: Correspondence[] = picks.map((pick) => ({
    px: pick.imageU * frame.width,
    py: pick.imageV * frame.height,
    xM: pick.xM,
    yM: pick.yM,
  }));

  return solveHomography(points, frame);
}

export const useCalibrationStore = create<CalibrationState>((set, get) => ({
  videoId: null,
  calibrations: [],
  picks: [],
  fromMs: 0,
  pitchLengthM: DEFAULT_PITCH_LENGTH_M,
  pitchWidthM: DEFAULT_PITCH_WIDTH_M,
  pendingFeature: null,
  editingId: null,
  error: null,

  async load(videoId, size) {
    try {
      const calibrations = await calibrationsQuery.listCalibrations(videoId);
      set({
        videoId,
        calibrations,
        picks: [],
        editingId: null,
        pendingFeature: null,
        fromMs: 0,
        pitchLengthM: size?.lengthM ?? get().pitchLengthM ?? DEFAULT_PITCH_LENGTH_M,
        pitchWidthM: size?.widthM ?? get().pitchWidthM ?? DEFAULT_PITCH_WIDTH_M,
        error: null,
      });
    } catch (error) {
      set({ videoId, calibrations: [], error: messageOf(error) });
    }
  },

  clear() {
    set({
      videoId: null,
      calibrations: [],
      picks: [],
      pendingFeature: null,
      editingId: null,
      fromMs: 0,
      error: null,
    });
  },

  startPicking(featureKey) {
    const state = get();
    const key = featureKey ?? nextRecommended(state.picks.map((pick) => pick.feature));
    set({ pendingFeature: key, error: null });
  },

  async addPick(imageU, imageV) {
    const state = get();
    const key = state.pendingFeature;
    if (!key) return;

    const feature = findFeature({ lengthM: state.pitchLengthM, widthM: state.pitchWidthM }, key);
    if (!feature) {
      set({ error: `Unknown pitch feature: ${key}` });
      return;
    }

    const pick: Pick = { feature: key, imageU, imageV, xM: feature.x, yM: feature.y };
    // Picking the same feature twice replaces it rather than duplicating it.
    const picks = [...state.picks.filter((existing) => existing.feature !== key), pick];
    set({ picks, pendingFeature: nextRecommended(picks.map((p) => p.feature)), error: null });
  },

  removePick(feature) {
    const picks = get().picks.filter((pick) => pick.feature !== feature);
    set({ picks, pendingFeature: feature, error: null });
  },

  clearPicks() {
    set({ picks: [], pendingFeature: nextRecommended([]), editingId: null, error: null });
  },

  setFromMs(ms) {
    set({ fromMs: Math.max(0, Math.round(ms)) });
  },

  setPitchSize(size) {
    set({ pitchLengthM: size.lengthM, pitchWidthM: size.widthM });
  },

  /** Reopens a stored calibration so it can be adjusted rather than redone. */
  edit(id) {
    const stored = get().calibrations.find((calibration) => calibration.id === id);
    if (!stored) return;
    set({
      picks: stored.points.map((point) => ({ ...point })),
      fromMs: stored.fromMs,
      pitchLengthM: stored.pitchLengthM,
      pitchWidthM: stored.pitchWidthM,
      editingId: id,
      pendingFeature: null,
      error: null,
    });
  },

  async save(frame) {
    const state = get();
    if (state.videoId === null) return false;

    const outcome = solvePicks(state.picks, frame);
    if (!outcome) {
      set({ error: "Pick at least four reference points before saving." });
      return false;
    }
    if (!outcome.ok) {
      set({ error: outcome.reason });
      return false;
    }

    try {
      await calibrationsQuery.saveCalibration({
        videoId: state.videoId,
        fromMs: state.fromMs,
        pitchLengthM: state.pitchLengthM,
        pitchWidthM: state.pitchWidthM,
        rmsErrorPx: outcome.quality.rmsErrorPx,
        points: state.picks.map((pick) => ({
          feature: pick.feature,
          imageU: pick.imageU,
          imageV: pick.imageV,
          xM: pick.xM,
          yM: pick.yM,
        })),
      });

      const calibrations = await calibrationsQuery.listCalibrations(state.videoId);
      set({ calibrations, picks: [], editingId: null, pendingFeature: null, error: null });
      return true;
    } catch (error) {
      set({ error: messageOf(error) });
      return false;
    }
  },

  async remove(id) {
    try {
      await calibrationsQuery.deleteCalibration(id);
      const videoId = get().videoId;
      set({
        calibrations: videoId === null ? [] : await calibrationsQuery.listCalibrations(videoId),
        error: null,
      });
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  reportError(message) {
    set({ error: message });
  },

  clearError() {
    set({ error: null });
  },
}));

/** The calibration in force at a moment, if the video has one. */
export function activeCalibrationAt(
  calibrations: StoredCalibration[],
  atMs: number,
): StoredCalibration | null {
  return resolveCalibration(calibrations, atMs);
}
