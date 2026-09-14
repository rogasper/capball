import type { Primitive } from "@/lib/annotate/primitives";
import type { AnnotationStyle } from "@/lib/annotate/types";
import { applyHomography, invertHomography } from "./homography";
import { type PitchSize, pitchOutline } from "./pitchModel";
import { isSupported, type SupportedRegion } from "./positions";

/**
 * The pitch drawn where it is in the video (FR-30.2).
 *
 * The outline is projected through the calibration's inverse and rendered by the
 * same `renderPrimitives` the drawings use, so the verification overlay and the
 * annotations cannot disagree about where something is on the frame.
 *
 * Circles become dense polylines in the pitch model, because a circle projects
 * to a general conic and our primitive set has no general conic.
 *
 * When a supported region is supplied, only the parts of the pitch that region
 * constrains are drawn. Beyond it the projection is extrapolation, and drawing
 * the extrapolation is what made a tight-shot calibration look like a broken
 * pitch rather than an honest partial one (technical-design-R1 §6.3).
 */

export type Frame = { width: number; height: number };

/** Beyond this many frames out, a projection is treated as having run away. */
const RUNAWAY_SCREENS = 12;

export type ProjectedOutline = {
  /** Polylines in normalised frame coordinates. */
  lines: [number, number][][];
  /** True when a line had to be broken because part of it left the frame. */
  clipped: boolean;
  /** True when a line was broken because it left the region the picks support. */
  regionClipped: boolean;
};

function isUsable(px: number, py: number, frame: Frame): boolean {
  if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
  const limitX = frame.width * RUNAWAY_SCREENS;
  const limitY = frame.height * RUNAWAY_SCREENS;
  return Math.abs(px) <= limitX && Math.abs(py) <= limitY;
}

/**
 * Whether a projected pixel is inside the frame's runaway bound.
 *
 * Exported because a pitch-anchored **shape** needs the same rule the outline
 * does: a projection that lands twelve screens away is not a drawing, it is the
 * fit failing, and it must be dropped rather than rendered (M13).
 */
export function isUsableProjection(px: number, py: number, frame: Frame): boolean {
  return isUsable(px, py, frame);
}

export function projectOutline(
  h: number[],
  size: PitchSize,
  frame: Frame,
  region: SupportedRegion | null = null,
): ProjectedOutline {
  const inverse = invertHomography(h);
  const lines: [number, number][][] = [];
  let clipped = false;
  let regionClipped = false;

  for (const line of pitchOutline(size)) {
    let run: [number, number][] = [];

    for (const [xM, yM] of line.points) {
      // A run breaks where the projection runs away, and — when the picks only
      // constrain part of the pitch — where the line leaves that part.
      const supported = region === null || isSupported(region, [xM, yM]);
      if (!supported) {
        if (run.length > 1) lines.push(run);
        run = [];
        regionClipped = true;
        continue;
      }

      const { x: px, y: py } = applyHomography(inverse, xM, yM);

      if (!isUsable(px, py, frame)) {
        if (run.length > 1) lines.push(run);
        run = [];
        clipped = true;
        continue;
      }

      run.push([px / frame.width, py / frame.height]);
    }

    if (run.length > 1) lines.push(run);
  }

  return { lines, clipped, regionClipped };
}

export type OutlineStyle = Pick<AnnotationStyle, "stroke" | "width" | "opacity">;

/**
 * The outline as primitives, behind everything else.
 *
 * A negative `z` keeps the verification lines under any drawing, so checking a
 * calibration never hides what has been drawn on the frame.
 */
export function outlinePrimitives(
  h: number[],
  size: PitchSize,
  frame: Frame,
  style: OutlineStyle,
  region: SupportedRegion | null = null,
): Primitive[] {
  const { lines } = projectOutline(h, size, frame, region);

  return lines.map((points) => ({
    kind: "path" as const,
    z: -1,
    opacity: style.opacity,
    stroke: style.stroke,
    fill: null,
    // The outline is a stroked line, never a fill, so these are inert — but a
    // primitive carries them, and `solid` is the honest default (R2, FR-20.12).
    fillPattern: "solid" as const,
    patternScale: 0,
    patternAngle: 0,
    width: style.width,
    center: [0.5, 0.5] as [number, number],
    rotation: 0,
    annotationId: -1,
    points,
    closed: false,
    smooth: false,
    head: false,
  }));
}

/** Where a set of pitch positions lands on the frame, in normalised coordinates. */
export function projectPositions(
  h: number[],
  positions: { xM: number; yM: number }[],
  frame: Frame,
): ([number, number] | null)[] {
  const inverse = invertHomography(h);
  return positions.map((position) => {
    const { x: px, y: py } = applyHomography(inverse, position.xM, position.yM);
    if (!isUsable(px, py, frame)) return null;
    return [px / frame.width, py / frame.height];
  });
}
