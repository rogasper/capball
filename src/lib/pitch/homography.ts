import type { Correspondence, Quality, SolveOutcome } from "./types";

export type { Correspondence, Homography, Quality, SolveOutcome } from "./types";

/**
 * Image pixels → pitch metres, from reference points the user picked
 * (plans/technical-design-R1.md §6.2).
 *
 * The solve is a normalised DLT with the last coefficient fixed to 1, so eight
 * unknowns come from 2N equations: exactly determined at four points and
 * least-squares beyond that, through the 8×8 normal equations. Both point sets
 * are Hartley-normalised first — image coordinates in the hundreds against
 * metres in the tens make the raw system ill-conditioned, and a four-point fit
 * without it is numerically hopeless.
 *
 * The matrix is a derived artefact. The reference points are the record, so a
 * better model later can be fitted from the same clicks (D19).
 */

/** Four points is the mathematical minimum; the flow asks for more. */
export const MIN_POINTS = 4;

/** The band the owner accepted for a manual calibration (T8, 2026-09-12). */
export const RMS_GOOD_PX = 2;
export const RMS_ACCEPTABLE_PX = 6;

export const HOMOGRAPHY_LENGTH = 9;

type Point = [number, number];

/** Row-major 3×3 multiply. */
function multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(9).fill(0);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += a[row * 3 + k] * b[k * 3 + col];
      out[row * 3 + col] = sum;
    }
  }
  return out;
}

/** Inverse by adjugate, which also gives the reverse projection for free. */
export function invertHomography(h: number[]): number[] {
  const [a, b, c, d, e, f, g, i, j] = h;
  const A = e * j - f * i;
  const B = -(d * j - f * g);
  const C = d * i - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) {
    throw new Error("This calibration cannot be inverted; the reference points are degenerate.");
  }
  const adjugate = [
    A,
    -(b * j - c * i),
    b * f - c * e,
    B,
    a * j - c * g,
    -(a * f - c * d),
    C,
    -(a * i - b * g),
    a * e - b * d,
  ];
  return adjugate.map((value) => value / det);
}

/** Scale so the bottom-right coefficient is 1, when it is not already zero. */
function normaliseScale(h: number[]): number[] {
  const scale = h[8];
  if (Math.abs(scale) < 1e-12) return h;
  return h.map((value) => value / scale);
}

/** A map and its inverse-scaled copy, as the Hartley normalisation matrix. */
function normalisationMatrix(points: Point[]): { matrix: number[]; points: Point[] } {
  const count = points.length;
  const centroid: Point = [
    points.reduce((sum, p) => sum + p[0], 0) / count,
    points.reduce((sum, p) => sum + p[1], 0) / count,
  ];
  const meanDistance =
    points.reduce((sum, p) => sum + Math.hypot(p[0] - centroid[0], p[1] - centroid[1]), 0) / count;
  const scale = meanDistance < 1e-9 ? 1 : Math.SQRT2 / meanDistance;

  return {
    matrix: [scale, 0, -scale * centroid[0], 0, scale, -scale * centroid[1], 0, 0, 1],
    points: points.map(
      (p) => [(p[0] - centroid[0]) * scale, (p[1] - centroid[1]) * scale] as Point,
    ),
  };
}

/** How flat a point set is; zero means a straight line. */
function spreadDeterminant(points: Point[]): number {
  const count = points.length;
  if (count < 3) return 0;
  const cx = points.reduce((sum, p) => sum + p[0], 0) / count;
  const cy = points.reduce((sum, p) => sum + p[1], 0) / count;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of points) {
    sxx += (x - cx) ** 2;
    syy += (y - cy) ** 2;
    sxy += (x - cx) * (y - cy);
  }
  return (sxx * syy - sxy * sxy) / (count * count);
}

/**
 * Whether any three points sit on a straight line.
 *
 * Only fatal at exactly four points: four points with three in a row do not
 * determine a homography at all, while the same three inside a larger set are
 * harmless because the fit is over-determined. The tempting quartet — the centre
 * spot and both penalty spots are all on the halfway-line axis, plus one more —
 * is exactly this case, so it is worth naming rather than reporting as a generic
 * failure.
 */
function hasCollinearTriple(points: Point[]): boolean {
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      for (let k = j + 1; k < points.length; k++) {
        const area =
          Math.abs(
            (points[j][0] - points[i][0]) * (points[k][1] - points[i][1]) -
              (points[k][0] - points[i][0]) * (points[j][1] - points[i][1]),
          ) / 2;
        if (area < 1e-3) return true;
      }
    }
  }
  return false;
}

/** Gaussian elimination with partial pivoting; null when a pivot vanishes. */
function solveLinear(matrix: number[][], rhs: number[]): number[] | null {
  const size = rhs.length;
  const a = matrix.map((row, index) => [...row, rhs[index]]);

  for (let col = 0; col < size; col++) {
    let pivotRow = col;
    for (let row = col + 1; row < size; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivotRow][col])) pivotRow = row;
    }
    if (Math.abs(a[pivotRow][col]) < 1e-12) return null;
    [a[col], a[pivotRow]] = [a[pivotRow], a[col]];

    for (let row = col + 1; row < size; row++) {
      const factor = a[row][col] / a[col][col];
      if (factor === 0) continue;
      for (let k = col; k <= size; k++) a[row][k] -= factor * a[col][k];
    }
  }

  const solution = new Array<number>(size).fill(0);
  for (let row = size - 1; row >= 0; row--) {
    let sum = a[row][size];
    for (let col = row + 1; col < size; col++) sum -= a[row][col] * solution[col];
    solution[row] = sum / a[row][row];
  }
  return solution;
}

/** Applies a homography to a pixel, in homogeneous coordinates. */
export function applyHomography(h: number[], px: number, py: number): { x: number; y: number } {
  const w = h[6] * px + h[7] * py + h[8];
  return {
    x: (h[0] * px + h[1] * py + h[2]) / w,
    y: (h[3] * px + h[4] * py + h[5]) / w,
  };
}

/** Maps a pitch position back to a pixel, for the verification overlay. */
export function projectToImage(h: number[], xM: number, yM: number): { px: number; py: number } {
  const inverse = invertHomography(h);
  const point = applyHomography(inverse, xM, yM);
  return { px: point.x, py: point.y };
}

/** Distance, in pixels, between a pitch point's projection and the pick. */
export function residualsPx(h: number[], points: Correspondence[]): number[] {
  const inverse = invertHomography(h);
  return points.map((point) => {
    const projected = applyHomography(inverse, point.xM, point.yM);
    return Math.hypot(projected.x - point.px, projected.y - point.py);
  });
}

export function solveHomography(
  points: Correspondence[],
  frame?: { width: number; height: number },
): SolveOutcome {
  if (points.length < MIN_POINTS) {
    return {
      ok: false,
      reason: `A calibration needs at least ${MIN_POINTS} reference points; ${points.length} picked.`,
    };
  }

  const image = normalisationMatrix(points.map((p) => [p.px, p.py] as Point));
  const pitch = normalisationMatrix(points.map((p) => [p.xM, p.yM] as Point));

  if (spreadDeterminant(image.points) < 1e-4) {
    return {
      ok: false,
      reason: "Those points are in a line. Spread them across the pitch so the fit has depth.",
    };
  }

  // Two rows per correspondence, eight unknowns.
  const normal = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
  const rhs = new Array<number>(8).fill(0);

  points.forEach((_, index) => {
    const [u, v] = image.points[index];
    const [x, y] = pitch.points[index];
    const rows: [number[], number][] = [
      [[u, v, 1, 0, 0, 0, -u * x, -v * x], x],
      [[0, 0, 0, u, v, 1, -u * y, -v * y], y],
    ];

    for (const [row, value] of rows) {
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) normal[i][j] += row[i] * row[j];
        rhs[i] += row[i] * value;
      }
    }
  });

  const solution = solveLinear(normal, rhs);
  if (!solution) {
    if (points.length === MIN_POINTS && hasCollinearTriple(image.points)) {
      return {
        ok: false,
        reason:
          "Three of these four points are in a straight line, so they do not fix a calibration. Add another point off that line.",
      };
    }
    return {
      ok: false,
      reason: "Those points do not determine a calibration. Spread them out and try again.",
    };
  }

  const normalised = [...solution, 1];
  // Undo the normalisation: pitch⁻¹ · Hn · image.
  const h = normaliseScale(
    multiply(invertHomography(pitch.matrix), multiply(normalised, image.matrix)),
  );

  let residuals: number[];
  try {
    residuals = residualsPx(h, points);
  } catch {
    return { ok: false, reason: "Those points do not determine a calibration." };
  }

  const rmsErrorPx = Math.sqrt(
    residuals.reduce((sum, value) => sum + value * value, 0) / residuals.length,
  );

  return { ok: true, h, quality: assess(rmsErrorPx, residuals, points, frame) };
}

function assess(
  rmsErrorPx: number,
  residualsPx: number[],
  points: Correspondence[],
  frame?: { width: number; height: number },
): Quality {
  const verdict =
    rmsErrorPx <= RMS_GOOD_PX ? "good" : rmsErrorPx <= RMS_ACCEPTABLE_PX ? "acceptable" : "poor";

  let warning: string | null = null;

  if (frame && frame.width > 0 && frame.height > 0) {
    const xs = points.map((p) => p.px);
    const ys = points.map((p) => p.py);
    const boxArea = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    const covered = boxArea / (frame.width * frame.height);
    if (covered < 0.08) {
      warning =
        "The points you picked cover a small part of the frame, so positions away from them will be less certain.";
    }
  }

  if (!warning && verdict === "poor") {
    warning =
      "One of these is probably picked in the wrong place — check the outline against the pitch lines.";
  }

  return { rmsErrorPx, residualsPx, verdict, warning };
}

/**
 * The calibration in force at a moment: the latest one that has already started.
 *
 * A second calibration from a chosen time onwards is OQ-4's leaning, and this is
 * all it takes to support it — a single row at `fromMs = 0` behaves as "once per
 * video".
 */
export function resolveCalibration<T extends { fromMs: number }>(
  calibrations: T[],
  atMs: number,
): T | null {
  let active: T | null = null;
  for (const calibration of calibrations) {
    if (calibration.fromMs > atMs) continue;
    if (!active || calibration.fromMs > active.fromMs) active = calibration;
  }
  return active;
}
