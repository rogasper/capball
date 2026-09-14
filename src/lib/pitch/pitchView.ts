import { boundsOfPoints, type Point, type Rect } from "@/lib/annotate/geometry";
import type { AnnotationStyle, Geometry, ShapeKind } from "@/lib/annotate/types";
import { type Bounds, patternSegments, type Segment } from "@/lib/render/pattern";
import type { PitchSize } from "./pitchModel";
import { shapeOutline } from "./shapePrimitives";

/**
 * The pitch view's coordinate space (FR-30.5, FR-80.2).
 *
 * The view is an SVG whose `viewBox` **is** the pitch in metres, which is what
 * makes a pitch-anchored shape drawable there without a transform: its numbers
 * are already the view's coordinates. Only the pointer needs converting, and
 * that is done here rather than through `getScreenCTM` so it can be tested —
 * jsdom has no `createSVGPoint`.
 */

/** Space around the touchlines so a shape drawn outside them is still visible. */
export const VIEW_MARGIN_M = 4;

export type ViewBox = { minX: number; minY: number; width: number; height: number };
export type Box = { left: number; top: number; width: number; height: number };

export function viewBoxOf(size: PitchSize): ViewBox {
  const halfLength = size.lengthM / 2;
  const halfWidth = size.widthM / 2;
  return {
    minX: -halfLength - VIEW_MARGIN_M,
    minY: -halfWidth - VIEW_MARGIN_M,
    width: size.lengthM + VIEW_MARGIN_M * 2,
    height: size.widthM + VIEW_MARGIN_M * 2,
  };
}

/**
 * A client point as pitch metres.
 *
 * This reproduces SVG's default `xMidYMid meet` fit — one uniform scale, centred
 * — because the element's aspect ratio and the viewBox's need not match. Reading
 * it from the element's box rather than from a transform matrix keeps the rule
 * in one testable place.
 */
export function screenToPitch(
  clientX: number,
  clientY: number,
  box: Box,
  viewBox: ViewBox,
): Point | null {
  if (box.width <= 0 || box.height <= 0) return null;
  const scale = Math.min(box.width / viewBox.width, box.height / viewBox.height);
  if (!(scale > 0)) return null;

  const offsetX = box.left + (box.width - viewBox.width * scale) / 2;
  const offsetY = box.top + (box.height - viewBox.height * scale) / 2;
  return [viewBox.minX + (clientX - offsetX) / scale, viewBox.minY + (clientY - offsetY) / scale];
}

/**
 * The same mapping as a `Rect` the annotation editor already understands.
 *
 * `handlesFor`, `hitTest`, `resizeBy`, `rotateTo` and `moveVertexTo` all work
 * against a rect with the rule `px = rect.x + value * rect.w`. Feed them this
 * rect — whose "value" axis is a metre — and the whole R1/M12 toolkit manipulates
 * a pitch-anchored shape without knowing that its units are metres (ADR 0008).
 *
 * The box passed in must already be relative to the element the handles live in,
 * because that is the space the returned pixels are in.
 */
export function pitchRectOf(box: Box, viewBox: ViewBox): Rect {
  const measured = Math.min(box.width / viewBox.width, box.height / viewBox.height);
  const scale = measured > 0 ? measured : 1;
  const offsetX = box.left + (box.width - viewBox.width * scale) / 2;
  const offsetY = box.top + (box.height - viewBox.height * scale) / 2;
  return {
    x: offsetX - viewBox.minX * scale,
    y: offsetY - viewBox.minY * scale,
    w: scale,
    h: scale,
  };
}

/** The `d` attribute for a shape in metres, from the outline both surfaces use. */
export function pathDataOf(geometry: Geometry, kind: ShapeKind): string | null {
  const outline = shapeOutline(geometry, kind);
  if (!outline || outline.points.length < 2) return null;

  const [first, ...rest] = outline.points;
  const move = `M${first[0]} ${first[1]}`;
  const lines = rest.map(([x, y]) => `L${x} ${y}`).join(" ");
  const curve = outline.smooth ? " " : " ";
  return `${move}${curve}${lines}${outline.closed ? " Z" : ""}`;
}

/**
 * The hatch lines for a patterned shape, in metres.
 *
 * Spacing is a fraction of the **pitch length** here rather than of the picture
 * width: the pitch view's unit is a metre, and the pitch is what the drawn shape
 * is measured against. The same generator serves both surfaces, so a hatch in
 * the pitch view and the same hatch over the frame differ only in density, never
 * in kind.
 */
export function patternLinesInPitch(
  geometry: Geometry,
  kind: ShapeKind,
  style: AnnotationStyle,
  size: PitchSize,
): Segment[] {
  if (style.fillPattern !== "hatch" && style.fillPattern !== "crossHatch") return [];
  const outline = shapeOutline(geometry, kind);
  if (!outline?.closed || outline.points.length < 3) return [];

  const xs = outline.points.map((point) => point[0]);
  const ys = outline.points.map((point) => point[1]);
  const bounds: Bounds = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };

  return patternSegments(
    bounds,
    Math.max(0.1, style.patternScale * size.lengthM),
    style.patternAngle,
    style.fillPattern,
  );
}

/** A shape's bounds in metres, for a caller that needs to place or size it. */
export function pitchBoundsOf(geometry: Geometry, kind: ShapeKind): Bounds | null {
  const outline = shapeOutline(geometry, kind);
  if (!outline || outline.points.length === 0) return null;
  const box = boundsOfPoints(outline.points);
  return { x: box.x, y: box.y, w: box.w, h: box.h };
}
