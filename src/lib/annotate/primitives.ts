import { absolutePoints, type Point } from "./geometry";
import type { Annotation, FillPattern, StrokePattern } from "./types";
import { isVisibleAt, type WindowContext } from "./window";

/**
 * The one drawing contract (plans/technical-design-R1.md §5.2).
 *
 * A primitive is resolution-independent and knows nothing about canvases. The
 * renderer turns primitives into pixels; the app and the burn-in both hand it
 * the same list, which is why NFR-27 holds by construction rather than by test.
 */

type PrimitiveBase = {
  /** Paint order; the layers panel shows the same order. */
  z: number;
  opacity: number;
  stroke: string | null;
  fill: string | null;
  /** Stroke width as a fraction of the frame's width. */
  width: number;
  /**
   * Font size as a fraction of the frame's height. A text shape's words, and the
   * size of a label chip on any other shape (FR-20.15).
   */
  fontSize: number;
  /** How the fill is painted (FR-20.12). `solid` is R1's behaviour. */
  fillPattern: FillPattern;
  /** Hatch spacing as a fraction of the picture width. */
  patternScale: number;
  /** Hatch angle in radians. */
  patternAngle: number;
  /** The line's own pattern (FR-20.14). `solid` is every style written before R2. */
  strokePattern: StrokePattern;
  /** Rotation origin, in normalised frame coordinates. */
  center: Point;
  rotation: number;
  /** The annotation this came from, so a hit can be mapped back to a layer. */
  annotationId: number;
  /** The words attached to the shape (FR-20.15); drawn for every kind but text. */
  label: string | null;
};

export type Primitive =
  | (PrimitiveBase & {
      kind: "path";
      points: Point[];
      closed: boolean;
      /** Freehand strokes are drawn as curves through their points. */
      smooth: boolean;
      /** An arrowhead is filled at the last point. */
      head: boolean;
    })
  | (PrimitiveBase & { kind: "rect"; x: number; y: number; w: number; h: number })
  | (PrimitiveBase & { kind: "ellipse"; x: number; y: number; w: number; h: number })
  | (PrimitiveBase & {
      kind: "text";
      x: number;
      y: number;
      text: string;
    });

function base(annotation: Annotation): PrimitiveBase {
  const { geometry, style } = annotation;
  return {
    z: annotation.z,
    opacity: style.opacity,
    stroke: style.stroke,
    fill: style.fill,
    width: style.width,
    fontSize: style.fontSize,
    fillPattern: style.fillPattern,
    patternScale: style.patternScale,
    patternAngle: style.patternAngle,
    strokePattern: style.strokePattern,
    center: [geometry.x + geometry.w / 2, geometry.y + geometry.h / 2],
    rotation: geometry.rotation,
    annotationId: annotation.id,
    label: annotation.label,
  };
}

export function toPrimitive(annotation: Annotation): Primitive {
  const { geometry, kind } = annotation;
  const common = base(annotation);
  const box = { x: geometry.x, y: geometry.y, w: geometry.w, h: geometry.h };

  switch (kind) {
    case "rect":
      return { ...common, kind: "rect", ...box };
    case "ellipse":
      return { ...common, kind: "ellipse", ...box };
    case "text":
      return {
        ...common,
        kind: "text",
        x: geometry.x,
        y: geometry.y,
        text: annotation.label ?? "",
      };
    case "polygon":
      return {
        ...common,
        kind: "path",
        points: absolutePoints(geometry),
        closed: true,
        smooth: false,
        head: false,
      };
    case "freehand":
      return {
        ...common,
        kind: "path",
        points: absolutePoints(geometry),
        closed: false,
        smooth: true,
        head: false,
      };
    case "arrow":
      return {
        ...common,
        kind: "path",
        points: absolutePoints(geometry),
        closed: false,
        smooth: false,
        head: true,
      };
    case "line":
      return {
        ...common,
        kind: "path",
        points: absolutePoints(geometry),
        closed: false,
        smooth: false,
        head: false,
      };
  }
}

/** The annotations visible at a moment, in paint order. */
export function visibleAnnotations(
  annotations: Annotation[],
  atMs: number,
  ctx: WindowContext,
): Annotation[] {
  return sortByLayer(annotations).filter((annotation) => isVisibleAt(annotation, atMs, ctx));
}

/** Back to front: ascending `z`, with the id breaking ties so order is stable. */
export function sortByLayer(annotations: Annotation[]): Annotation[] {
  return [...annotations].sort((a, b) => a.z - b.z || a.id - b.id);
}

export function toPrimitives(
  annotations: Annotation[],
  atMs: number,
  ctx: WindowContext,
): Primitive[] {
  return visibleAnnotations(annotations, atMs, ctx).map(toPrimitive);
}
