import type { Point } from "@/lib/annotate/geometry";
import { applyHomography, solveHomography } from "./homography";
import { onPitch, type PitchSize } from "./pitchModel";

/**
 * Turning a click into a pitch position, and being honest about it (FR-30.3, NFR-26).
 *
 * A calibration only constrains the region its reference points span. Inside that
 * region the fit is good to about a metre; outside it the projection is
 * extrapolation, and a tight calibration extrapolates badly — measured at 11 m of
 * median error when the picks came from a single penalty area. So a position is
 * refused when it falls off the pitch, and accepted with a warning when it falls
 * outside the region the calibration actually covers. It is never silently
 * presented as if it were exact.
 */

/** How far beyond the reference points a position is still treated as covered. */
export const SUPPORT_MARGIN_M = 5;

/** The convex hull of the reference points, in pitch metres. */
export function convexHull(points: Point[]): Point[] {
  if (points.length <= 2) return [...points];

  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Point, a: Point, b: Point) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const build = (input: Point[]): Point[] => {
    const chain: Point[] = [];
    for (const point of input) {
      while (
        chain.length >= 2 &&
        cross(chain[chain.length - 2], chain[chain.length - 1], point) <= 0
      ) {
        chain.pop();
      }
      chain.push(point);
    }
    return chain;
  };

  const lower = build(sorted);
  const upper = build([...sorted].reverse());
  // Counter-clockwise, with the closing point dropped.
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Shoelace area, always positive. */
export function hullArea(hull: Point[]): number {
  if (hull.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i];
    const [x2, y2] = hull[(i + 1) % hull.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

export type SupportedRegion = {
  hull: Point[];
  areaM2: number;
  /** The hull's area as a share of the pitch. */
  shareOfPitch: number;
};

export function supportedRegion(picks: Point[], size: PitchSize): SupportedRegion {
  const hull = convexHull(picks);
  const areaM2 = hullArea(hull);
  const pitchArea = Math.max(1, size.lengthM * size.widthM);
  return { hull, areaM2, shareOfPitch: areaM2 / pitchArea };
}

/**
 * Whether a pitch position lies within the region the picks constrain.
 *
 * The hull is treated as counter-clockwise, so the inside is to the left of every
 * directed edge; a position is accepted up to `marginM` beyond an edge, because a
 * player standing just past the last reference point is still within the fit's
 * reach. With no region at all — no picks to hand — everything is reported as
 * uncovered rather than silently trusted.
 */
export function isSupported(
  region: SupportedRegion,
  point: Point,
  marginM = SUPPORT_MARGIN_M,
): boolean {
  const { hull } = region;
  if (hull.length < 3) return false;

  for (let i = 0; i < hull.length; i++) {
    const [ax, ay] = hull[i];
    const [bx, by] = hull[(i + 1) % hull.length];
    const ex = bx - ax;
    const ey = by - ay;
    const length = Math.hypot(ex, ey);
    if (length < 1e-9) continue;

    // Signed distance from the edge, positive on the inside.
    const distance = (ex * (point[1] - ay) - ey * (point[0] - ax)) / length;
    if (distance < -marginM) return false;
  }
  return true;
}

export type PositionVerdict =
  | { ok: true; xM: number; yM: number; supported: boolean; warning: string | null }
  | { ok: false; reason: string };

/**
 * Where a click lands on the pitch, or why it does not.
 *
 * `xM`/`yM` are what gets stored: the user's assertion, never re-derived on read,
 * so adjusting the calibration later cannot silently move a position they placed.
 */
export function derivePosition(
  h: number[],
  click: { imageU: number; imageV: number },
  frame: { width: number; height: number },
  size: PitchSize,
  region: SupportedRegion | null,
): PositionVerdict {
  if (frame.width <= 0 || frame.height <= 0) {
    return { ok: false, reason: "The video's size is not known yet." };
  }

  const mapped = applyHomography(h, click.imageU * frame.width, click.imageV * frame.height);
  if (!Number.isFinite(mapped.x) || !Number.isFinite(mapped.y)) {
    return { ok: false, reason: "That point does not map onto the pitch." };
  }

  if (!onPitch({ x: mapped.x, y: mapped.y }, size)) {
    return { ok: false, reason: "That point is off the pitch, so nothing was stored." };
  }

  const supported = region !== null && isSupported(region, [mapped.x, mapped.y]);
  return {
    ok: true,
    xM: mapped.x,
    yM: mapped.y,
    supported,
    warning: supported
      ? null
      : "This is outside the area your reference points cover, so its position is a guess.",
  };
}

/** A one-line description of how much of the pitch the picks constrain. */
export function describeCoverage(region: SupportedRegion): string {
  const share = Math.round(region.shareOfPitch * 100);
  if (share >= 95) return "Your reference points cover the whole pitch.";
  if (share >= 60) return `Your reference points cover about ${share}% of the pitch.`;
  return `Your reference points cover only about ${share}% of the pitch, so positions outside that area will be unreliable.`;
}

/** A stored calibration's reference points, as the position flow needs them. */
export type StoredReference = {
  imageU: number;
  imageV: number;
  xM: number;
  yM: number;
};

/**
 * The homography a stored calibration implies.
 *
 * Derived on demand from the reference points rather than stored as a matrix
 * (D19), which is why a calibration can be improved later without the user
 * re-clicking anything.
 */
export function homographyOf(
  points: StoredReference[],
  frame: { width: number; height: number },
): ReturnType<typeof solveHomography> {
  const correspondences = points.map((point) => ({
    px: point.imageU * frame.width,
    py: point.imageV * frame.height,
    xM: point.xM,
    yM: point.yM,
  }));
  return solveHomography(correspondences, frame);
}

/** The region a stored calibration constrains, for the honesty checks. */
export function regionOf(points: StoredReference[], size: PitchSize): SupportedRegion {
  return supportedRegion(
    points.map((point) => [point.xM, point.yM] as Point),
    size,
  );
}
