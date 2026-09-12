/**
 * Calibration types (plans/technical-design-R1.md §6).
 *
 * A correspondence pairs a point the user clicked, in **video pixels**, with the
 * pitch position in **metres** of the named feature they said it was. Pixels are
 * the working space for the solve because that is where the error is measured and
 * where the numbers are large enough to stay well conditioned.
 */

export type Correspondence = {
  /** Clicked point, in video pixels. */
  px: number;
  py: number;
  /** The feature's real position, in metres from the centre of the pitch. */
  xM: number;
  yM: number;
};

/** Row-major 3×3, with the last coefficient scaled to 1. */
export type Homography = number[];

export type Quality = {
  /** Root-mean-square reprojection error, in video pixels. */
  rmsErrorPx: number;
  /** Per-point error, so a single bad pick can be pointed at. */
  residualsPx: number[];
  verdict: "good" | "acceptable" | "poor";
  /** One plain sentence when something is worth saying, otherwise null. */
  warning: string | null;
};

export type SolveOutcome =
  | { ok: true; h: Homography; quality: Quality }
  | { ok: false; reason: string };

/** A calibration as the app holds it, before it has a database id. */
export type CalibrationDraft = {
  videoId: number;
  /** The moment this calibration starts applying from (OQ-4). */
  fromMs: number;
  pitchLengthM: number;
  pitchWidthM: number;
  points: { feature: string; imageU: number; imageV: number; xM: number; yM: number }[];
};

/** A stored calibration, with the solve's own error. */
export type Calibration = CalibrationDraft & {
  id: number;
  rmsErrorPx: number;
};
