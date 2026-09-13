import { create } from "zustand";
import type { StoredCalibration } from "@/lib/db/queries/calibrations";
import * as calibrationsQuery from "@/lib/db/queries/calibrations";
import { resolveCalibration, solveHomography, worstResidual } from "@/lib/pitch/homography";
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
  /**
   * Features the user passed over, so the flow stops offering them. Not visible
   * on the frame is a normal reason to skip a landmark, and without this the
   * suggested next point would keep coming back to it.
   */
  skipped: string[];
  /** The stored calibration being reworked, if any. */
  editingId: number | null;
  error: string | null;

  load: (videoId: number, size?: PitchSize) => Promise<void>;
  clear: () => void;
  startPicking: (featureKey: string | null) => void;
  /** Passes over the feature being offered and moves to the next suggestion. */
  skipPending: () => void;
  addPick: (imageU: number, imageV: number) => Promise<void>;
  /** Moves an already-placed pick, for adjusting it against the frame. */
  movePick: (featureKey: string, imageU: number, imageV: number) => void;
  removePick: (featureKey: string) => void;
  clearPicks: () => void;
  setFromMs: (ms: number) => void;
  setPitchSize: (size: PitchSize) => void;
  edit: (id: number) => void;
  /**
   * Saves, unless the fit is poor — in which case it refuses and names the point
   * most likely to be wrong. `force` is the deliberate override the panel offers.
   */
  save: (frame: { width: number; height: number }, force?: boolean) => Promise<boolean>;
  remove: (id: number) => Promise<void>;
  reportError: (message: string) => void;
  clearError: () => void;
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The next feature the flow should offer, so the picks stay well spread.
 *
 * Skips whatever has been picked or passed over; otherwise the suggestion would
 * loop back to a landmark the user just said they cannot see.
 */
export function nextRecommended(usedFeatures: string[], skipped: string[] = []): string | null {
  return (
    RECOMMENDED_FEATURE_KEYS.find((key) => !usedFeatures.includes(key) && !skipped.includes(key)) ??
    null
  );
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

  return solveHomography(points);
}

export const useCalibrationStore = create<CalibrationState>((set, get) => ({
  videoId: null,
  calibrations: [],
  picks: [],
  fromMs: 0,
  pitchLengthM: DEFAULT_PITCH_LENGTH_M,
  pitchWidthM: DEFAULT_PITCH_WIDTH_M,
  pendingFeature: null,
  skipped: [],
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
        skipped: [],
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
      skipped: [],
      editingId: null,
      fromMs: 0,
      error: null,
    });
  },

  startPicking(featureKey) {
    const state = get();
    const key =
      featureKey ??
      nextRecommended(
        state.picks.map((pick) => pick.feature),
        state.skipped,
      );
    set({ pendingFeature: key, error: null });
  },

  skipPending() {
    const state = get();
    const skipped = state.pendingFeature ? [...state.skipped, state.pendingFeature] : state.skipped;
    const used = state.picks.map((pick) => pick.feature);
    set({ skipped, pendingFeature: nextRecommended(used, skipped), error: null });
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
    set({
      picks,
      // Placing a point clears the skips: the set has moved on, and a landmark
      // passed over earlier may be worth offering again.
      skipped: [],
      pendingFeature: nextRecommended(picks.map((p) => p.feature)),
      error: null,
    });
  },

  movePick(featureKey, imageU, imageV) {
    const picks = get().picks.map((pick) =>
      pick.feature === featureKey ? { ...pick, imageU, imageV } : pick,
    );
    set({ picks, error: null });
  },

  removePick(feature) {
    const picks = get().picks.filter((pick) => pick.feature !== feature);
    set({ picks, pendingFeature: feature, error: null });
  },

  clearPicks() {
    set({
      picks: [],
      pendingFeature: nextRecommended([]),
      skipped: [],
      editingId: null,
      error: null,
    });
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
      skipped: [],
      error: null,
    });
  },

  async save(frame, force = false) {
    const state = get();
    if (state.videoId === null) return false;

    const outcome = solvePicks(state.picks, frame);
    if (!outcome) {
      set({ error: "Pick at least four reference points before saving." });
      return false;
    }
    if (!outcome.ok) {
      // Name the features the failure points at rather than printing indices.
      const size = { lengthM: state.pitchLengthM, widthM: state.pitchWidthM };
      const suspects = (outcome.suspectIndices ?? [])
        .map((index) => {
          const pick = state.picks[index];
          if (!pick) return null;
          return findFeature(size, pick.feature)?.label ?? pick.feature;
        })
        .filter((label): label is string => label !== null);

      set({
        error:
          suspects.length > 0
            ? `${outcome.reason} Check “${suspects.join("” and “")}”.`
            : outcome.reason,
      });
      return false;
    }

    // A fit outside the accepted band is refused by the ordinary path, and the
    // point most likely to be wrong is named. The panel offers a deliberate
    // override, because a user looking at the frame knows more than the residual
    // does — but they have to say so.
    if (outcome.quality.verdict === "poor" && !force) {
      const size = { lengthM: state.pitchLengthM, widthM: state.pitchWidthM };
      const worst = worstResidual(outcome.quality.residualsPx);
      const suspect = worst ? state.picks[worst.index]?.feature : undefined;
      const label = (suspect && findFeature(size, suspect)?.label) ?? suspect ?? "one point";
      set({
        error: `This fit is ${outcome.quality.rmsErrorPx.toFixed(1)} px off, which is outside the band. “${label}” is the most likely mis-pick (${worst?.px.toFixed(1) ?? "?"} px). Check or remove that point, or save it anyway.`,
      });
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
