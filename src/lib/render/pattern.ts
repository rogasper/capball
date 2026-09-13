import type { Point } from "@/lib/annotate/geometry";

/**
 * Hatch generation for patterned fills (FR-20.12, NFR-40).
 *
 * The pattern is **computed from the shape's bounds** rather than tiled from an
 * image (ADR 0009). Two properties follow, and both are the point:
 *
 * 1. Resolution independence. The caller passes a spacing already scaled to the
 *    picture (a fraction of its width), so the 1080p export gets the same
 *    pattern as the preview without a texture that would blur or alias.
 * 2. A bounded cost. A full-pitch zone at a small spacing could ask for
 *    thousands of lines, so the count is capped and the spacing grows to meet
 *    the cap: a pattern is decoration on an analysis and must never be able to
 *    make a repaint or an export slow.
 *
 * Everything here is pure and works in pixels of whatever surface is drawing,
 * which is what makes it testable without a rasteriser.
 */

/** The most hatch lines one primitive may produce, across all its directions. */
export const MAX_HATCH_LINES = 240;

export type Bounds = { x: number; y: number; w: number; h: number };
export type Segment = [Point, Point];

function corners(bounds: Bounds): Point[] {
  return [
    [bounds.x, bounds.y],
    [bounds.x + bounds.w, bounds.y],
    [bounds.x + bounds.w, bounds.y + bounds.h],
    [bounds.x, bounds.y + bounds.h],
  ];
}

function rotate(point: Point, origin: Point, angle: number): Point {
  if (angle === 0) return point;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point[0] - origin[0];
  const dy = point[1] - origin[1];
  return [origin[0] + dx * cos - dy * sin, origin[1] + dx * sin + dy * cos];
}

/** The bounding box of the bounds once rotated by `angle` about their centre. */
export function rotatedBounds(bounds: Bounds, angle: number): Bounds {
  const centre: Point = [bounds.x + bounds.w / 2, bounds.y + bounds.h / 2];
  const rotated = corners(bounds).map((corner) => rotate(corner, centre, angle));
  const xs = rotated.map((point) => point[0]);
  const ys = rotated.map((point) => point[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

/**
 * How many lines one direction needs at this spacing, and the spacing that
 * respects the cap when the answer is too many.
 */
export function hatchPlan(
  bounds: Bounds,
  spacingPx: number,
  angle: number,
  cap = MAX_HATCH_LINES,
  directions = 1,
): { spacing: number; count: number } {
  const box = rotatedBounds(bounds, angle);
  const spacing = Math.max(1, spacingPx);
  const wanted = Math.max(1, Math.ceil(box.h / spacing));
  const allowed = Math.max(1, Math.floor(cap / Math.max(1, directions)));
  if (wanted <= allowed) return { spacing, count: wanted };
  return { spacing: box.h / allowed, count: allowed };
}

/**
 * The hatch lines for one direction, as segments in pixel space.
 *
 * The lines cover the rotated bounds, so clipping the caller's path is what
 * keeps the pattern inside the shape — the generator deliberately does not know
 * the shape, which is why it can serve a rectangle, an ellipse and a polygon
 * with the same code.
 */
export function hatchSegments(
  bounds: Bounds,
  spacingPx: number,
  angle: number,
  cap = MAX_HATCH_LINES,
  directions = 1,
  offset = 0,
): Segment[] {
  const box = rotatedBounds(bounds, angle);
  const { spacing, count } = hatchPlan(bounds, spacingPx, angle, cap, directions);
  const centre: Point = [bounds.x + bounds.w / 2, bounds.y + bounds.h / 2];
  const segments: Segment[] = [];

  // Lines are generated across the rotated box, then rotated back, so a single
  // pass of parallel lines covers any angle without trigonometry per line.
  const start = box.y + offset * spacing + spacing / 2;
  for (let i = 0; i < count; i++) {
    const y = start + i * spacing;
    const left: Point = [box.x, y];
    const right: Point = [box.x + box.w, y];
    segments.push([rotate(left, centre, -angle), rotate(right, centre, -angle)]);
  }

  return segments;
}

/**
 * Every segment a patterned fill needs, in one list.
 *
 * `crossHatch` is the same generator run again at 90°, and the cap is split
 * between the two directions by the caller of `hatchPlan` rather than applied
 * twice, so a cross-hatch is never twice the budget of a hatch.
 */
export function patternSegments(
  bounds: Bounds,
  spacingPx: number,
  angle: number,
  pattern: "hatch" | "crossHatch",
  cap = MAX_HATCH_LINES,
): Segment[] {
  const directions = pattern === "crossHatch" ? 2 : 1;
  const { spacing } = hatchPlan(bounds, spacingPx, angle, cap, directions);
  const first = hatchSegments(bounds, spacing, angle, cap, directions);
  if (pattern === "hatch") return first;
  return [...first, ...hatchSegments(bounds, spacing, angle + Math.PI / 2, cap, directions)];
}

/** The total line count for a plan, used by the T11 measurement and its test. */
export function patternLineCount(
  bounds: Bounds,
  spacingPx: number,
  pattern: "hatch" | "crossHatch",
  cap = MAX_HATCH_LINES,
): number {
  const directions = pattern === "crossHatch" ? 2 : 1;
  return pattern === "crossHatch"
    ? patternSegments(bounds, spacingPx, 0, pattern, cap).length
    : hatchPlan(bounds, spacingPx, 0, cap, directions).count;
}
