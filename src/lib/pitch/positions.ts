import type { Point } from "@/lib/annotate/geometry";
import { applyHomography, MIN_POINTS, nearDuplicatePicks, solveHomography } from "./homography";
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

/**
 * How much of the pitch has to be covered before the fit is worth trusting away
 * from its own points.
 *
 * This replaces the old frame-space warning, which was measured to stay silent in
 * the one case it existed for: seven picks inside a penalty area covered 44% of
 * the *frame* — comfortably above the 8% threshold — while covering about 15% of
 * the *pitch*, where the extrapolation error was 11 m (technical-design-R1 §6.3).
 */
export const NARROW_COVERAGE_SHARE = 0.6;

export function isNarrowCoverage(region: SupportedRegion): boolean {
  return region.shareOfPitch < NARROW_COVERAGE_SHARE;
}

/** A stored calibration's reference points, as the position flow needs them. */
export type StoredReference = {
  imageU: number;
  imageV: number;
  xM: number;
  yM: number;
};

/**
 * Whether an event's position markers belong on the frame at a moment.
 *
 * Positions have no time window of their own — a position is the assertion that
 * a player was *there*, at its event's anchor — so the honest rule is the
 * event's own range: inside it the markers are shown, outside it they hide.
 * Without this a marker stays pinned over footage where the player has long
 * since moved, which reads as "this is where they are now" rather than "this is
 * where they were". A drawing escapes the same problem with its window (§5.4);
 * this is the position's equivalent, resolved from the event rather than stored.
 *
 * Marking is the exception: placing a position needs the existing markers on
 * screen wherever the playhead happens to be.
 */
export function isPositionVisibleAt(
  atMs: number,
  range: { startMs: number; endMs: number } | null,
  marking: boolean,
): boolean {
  if (marking) return true;
  if (!range) return false;
  return atMs >= range.startMs && atMs <= range.endMs;
}

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
  return solveHomography(correspondences);
}

/** The region a stored calibration constrains, for the honesty checks. */
export function regionOf(points: StoredReference[], size: PitchSize): SupportedRegion {
  return supportedRegion(
    points.map((point) => [point.xM, point.yM] as Point),
    size,
  );
}

/**
 * What is wrong with a calibration **already stored**, if anything.
 *
 * Existing rows are not re-solved when they are listed, so a calibration saved
 * before these checks existed would otherwise still read as "lines up closely".
 * Found on real data: a stored four-point calibration had two clicks 1.2 px
 * apart that are 32 metres apart on the pitch, and reported 1.4e-10 px — the app
 * called it a good fit, which is how it survived review.
 */
export function storedCalibrationWarning(
  points: StoredReference[],
  frame: { width: number; height: number },
): string | null {
  const duplicate = nearDuplicatePicks(
    points.map((point) => ({
      px: point.imageU * frame.width,
      py: point.imageV * frame.height,
      xM: point.xM,
      yM: point.yM,
    })),
  );
  if (duplicate) {
    return "Two of its points are in the same place, so it cannot be right. Redo it.";
  }
  if (points.length <= MIN_POINTS) {
    return "Four points fit exactly, so its error is not evidence. Add another point.";
  }
  return null;
}
