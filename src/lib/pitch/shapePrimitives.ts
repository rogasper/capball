import type { Point } from "@/lib/annotate/geometry";
import {
  absolutePoints,
  hitTest,
  pathGeometry,
  type Rect,
  rotatePoint,
} from "@/lib/annotate/geometry";
import type { Primitive } from "@/lib/annotate/primitives";
import type { Annotation, AnnotationStyle, Geometry, ShapeKind } from "@/lib/annotate/types";
import { applyHomography, invertHomography } from "./homography";
import { isSupported, type SupportedRegion } from "./positions";
import { type Frame, isUsableProjection } from "./project";

/**
 * A shape drawn on the pitch, seen over the video (FR-80.2, FR-80.3).
 *
 * A pitch-anchored shape is stored in **metres**, so getting it onto the frame
 * means projecting every point through the calibration — and the projection is
 * not a transform of the shape's kind: a rectangle becomes a general
 * quadrilateral and a circle becomes a conic, neither of which our primitive set
 * can express as `rect` or `ellipse`. So the shape is first reduced to a
 * **polyline in metres** and then projected, which is exactly the trick the
 * pitch outline already uses for its circles (see `project.ts`). The result is
 * one `path` primitive, and the renderer never learns that the shape started as
 * a rectangle.
 *
 * The same polyline is what the pitch views draw in metres, so the two surfaces
 * cannot disagree about a shape's geometry — they differ only in whether the
 * points are projected first (D34/D36).
 *
 * Text is deliberately not projectable: a glyph placed on a plane in perspective
 * needs a transform per glyph, and drawing it upright from the box origin would
 * be a lie about where it sits. Text therefore stays a frame-space shape, and the
 * UI says so rather than offering it and faking it.
 */

/** How many segments a projected circle is drawn with. */
export const ELLIPSE_SAMPLES = 48;

export type ShapeOutline = {
  /** Points in metres, with the shape's own rotation already applied. */
  points: Point[];
  closed: boolean;
  smooth: boolean;
  head: boolean;
};

/** The box's four corners in metres, in the order the handle layer uses. */
function boxCorners(geometry: Geometry): Point[] {
  return [
    [geometry.x, geometry.y],
    [geometry.x + geometry.w, geometry.y],
    [geometry.x + geometry.w, geometry.y + geometry.h],
    [geometry.x, geometry.y + geometry.h],
  ];
}

/**
 * The shape as a polyline in metres, rotation applied.
 *
 * Rotation is baked into the points here because the primitive carries a
 * rotation for the renderer to apply in screen space; a rotation on the ground
 * plane is not a screen rotation once perspective is involved.
 */
export function shapeOutline(geometry: Geometry, kind: ShapeKind): ShapeOutline | null {
  const centre: Point = [geometry.x + geometry.w / 2, geometry.y + geometry.h / 2];
  const turn = (points: Point[]) =>
    points.map((point) => rotatePoint(point, centre, geometry.rotation));

  switch (kind) {
    case "rect":
      return { points: turn(boxCorners(geometry)), closed: true, smooth: false, head: false };
    case "polygon":
      return {
        points: turn(absolutePoints(geometry)),
        closed: true,
        smooth: false,
        head: false,
      };
    case "line":
      return { points: turn(absolutePoints(geometry)), closed: false, smooth: false, head: false };
    case "arrow":
      return { points: turn(absolutePoints(geometry)), closed: false, smooth: false, head: true };
    case "freehand":
      return { points: turn(absolutePoints(geometry)), closed: false, smooth: true, head: false };
    case "ellipse": {
      const cx = centre[0];
      const cy = centre[1];
      const rx = Math.abs(geometry.w) / 2;
      const ry = Math.abs(geometry.h) / 2;
      const points: Point[] = Array.from({ length: ELLIPSE_SAMPLES }, (_, index) => {
        const angle = (index / ELLIPSE_SAMPLES) * Math.PI * 2;
        return [cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)] as Point;
      });
      return { points: turn(points), closed: true, smooth: false, head: false };
    }
    case "text":
      return null;
  }
}

/** A projection always lands as a path: a projected box is a quadrilateral. */
export type ProjectedPath = Extract<Primitive, { kind: "path" }>;

export type ShapeProjection =
  | { ok: true; primitive: ProjectedPath; guessed: boolean; unsupported: number }
  | { ok: false; reason: "no-outline" | "runaway" | "unsupported" };

function styleOf(style: AnnotationStyle): ProjectedStyle {
  return {
    opacity: style.opacity,
    stroke: style.stroke,
    fill: style.fill,
    width: style.width,
    fillPattern: style.fillPattern,
    patternScale: style.patternScale,
    patternAngle: style.patternAngle,
  };
}

/** The style fields a projected path carries, spelled out because `Primitive`
 * is a union and a `Pick` across it would be a different type per member. */
type ProjectedStyle = {
  opacity: number;
  stroke: string | null;
  fill: string | null;
  width: number;
  fillPattern: AnnotationStyle["fillPattern"];
  patternScale: number;
  patternAngle: number;
};

/**
 * Projects one pitch-anchored shape onto the frame.
 *
 * The region rule is the honest half, and it is deliberately about the shape as
 * a whole rather than about its corners: a zone drawn over the middle of the
 * pitch may reach into an area the picks do not cover while the play it marks is
 * well inside it. So
 *
 * - a shape with **nothing** inside the covered area is not drawn at all: every
 *   part of it would be extrapolation, and R1 already refuses to draw
 *   extrapolated pitch lines;
 * - a shape that is only **partly** inside is drawn and reported as `guessed`,
 *   so the UI can say how many of the shapes on screen are a guide rather than a
 *   measurement (NFR-31, FR-80.2).
 */
export function projectShape(
  annotation: Annotation,
  h: number[],
  frame: Frame,
  region: SupportedRegion | null,
): ShapeProjection {
  const outline = shapeOutline(annotation.geometry, annotation.kind);
  if (!outline || outline.points.length < 2) return { ok: false, reason: "no-outline" };

  const inverse = invertHomography(h);
  const projected: Point[] = [];
  let supported = 0;

  for (const [xM, yM] of outline.points) {
    if (region !== null && isSupported(region, [xM, yM])) supported += 1;

    const { x, y } = applyHomography(inverse, xM, yM);
    if (!isUsableProjection(x, y, frame)) return { ok: false, reason: "runaway" };
    projected.push([x / frame.width, y / frame.height]);
  }

  if (region !== null && supported === 0) {
    // The centre counts too: a wide zone with every corner outside the covered
    // area can still mark play that is inside it.
    const [minX, maxX] = [
      Math.min(...outline.points.map((point) => point[0])),
      Math.max(...outline.points.map((point) => point[0])),
    ];
    const [minY, maxY] = [
      Math.min(...outline.points.map((point) => point[1])),
      Math.max(...outline.points.map((point) => point[1])),
    ];
    const centre: Point = [(minX + maxX) / 2, (minY + maxY) / 2];
    if (!isSupported(region, centre)) return { ok: false, reason: "unsupported" };
  }

  return {
    ok: true,
    guessed: region !== null && supported < outline.points.length,
    unsupported: region === null ? 0 : outline.points.length - supported,
    primitive: {
      kind: "path",
      z: annotation.z,
      annotationId: annotation.id,
      // The projection has already applied the rotation, so the renderer must
      // not apply it a second time.
      rotation: 0,
      center: [0.5, 0.5],
      points: projected,
      closed: outline.closed,
      smooth: outline.smooth,
      head: outline.head,
      ...styleOf(annotation.style),
    },
  };
}

export type ProjectionSummary = {
  primitives: ProjectedPath[];
  /** Shapes drawn, but only partly inside the region the calibration covers. */
  guessedIds: number[];
  /** Shapes not drawn at all, by reason. */
  omitted: { annotationId: number; reason: "no-outline" | "runaway" | "unsupported" }[];
  /** True when there was no calibration to project with. */
  uncalibrated: boolean;
};

/**
 * Projects a set of pitch-anchored shapes, keeping the ones that can be drawn.
 *
 * Nothing here throws or guesses: a shape that cannot be projected comes back in
 * `omitted` with its reason, because a silently missing drawing is worse than a
 * visible one that says it could not be placed (AGENTS.md: no silent failures).
 */
export function projectShapes(
  annotations: Annotation[],
  h: number[] | null,
  frame: Frame,
  region: SupportedRegion | null,
): ProjectionSummary {
  if (h === null || frame.width <= 0 || frame.height <= 0) {
    return { primitives: [], guessedIds: [], omitted: [], uncalibrated: true };
  }

  const primitives: ProjectedPath[] = [];
  const guessedIds: number[] = [];
  const omitted: ProjectionSummary["omitted"] = [];

  for (const annotation of annotations) {
    const result = projectShape(annotation, h, frame, region);
    if (!result.ok) {
      omitted.push({ annotationId: annotation.id, reason: result.reason });
      continue;
    }
    if (result.guessed) guessedIds.push(annotation.id);
    primitives.push(result.primitive);
  }

  return { primitives, guessedIds, omitted, uncalibrated: false };
}

/**
 * Which projected shape a pointer is over, topmost first.
 *
 * A pitch-anchored shape cannot be hit-tested against frame pixels, because its
 * own numbers are metres. It *can* be hit-tested against the shape it projects
 * to, which is what this does: the projection is turned back into an annotation
 * for the same `hitTest` the frame canvas uses, so a click on the video behaves
 * the same way for both kinds of shape.
 *
 * Returns the annotation id, or `null` when the pointer is over none of them.
 */
export function pitchShapeAt(
  summary: ProjectionSummary,
  px: Point,
  rect: Rect,
  tolerancePx: number,
): number | null {
  const ordered = [...summary.primitives].sort(
    (a, b) => b.z - a.z || b.annotationId - a.annotationId,
  );
  for (const primitive of ordered) {
    const asShape: Annotation = {
      id: primitive.annotationId,
      uid: "projected",
      eventId: 0,
      // A two-point projection is a line: R1's polygon rule refuses fewer than
      // three points, so a pitch-anchored line or arrow would otherwise be
      // impossible to click.
      kind: primitive.points.length < 3 ? "line" : "polygon",
      windowMode: "moment",
      windowMs: 0,
      geometry: pathGeometry(primitive.points),
      style: {
        ...stylesForHitTest,
        // A closed shape is a **region**, so a click inside it selects it with or
        // without a fill. This is not a detail: the projection turns every shape
        // into a polygon, and R1's polygon rule only tests the stroke unless
        // there is a fill — so an unfilled zone could only be grabbed by its own
        // outline, which reads as "I cannot select this at all".
        fill: primitive.closed ? "#000000" : null,
      },
      label: null,
      z: primitive.z,
    };
    if (hitTest(asShape, px, rect, tolerancePx)) return primitive.annotationId;
  }
  return null;
}

/** Only `fill` decides whether a projected path is clickable inside, so the rest
 * of the style is an inert value rather than a second source of truth. */
const stylesForHitTest: Annotation["style"] = {
  stroke: "#000000",
  fill: null,
  width: 0,
  fontSize: 0,
  opacity: 1,
  fillPattern: "solid",
  patternScale: 0,
  patternAngle: 0,
};

/**
 * Whether a geometry's numbers could belong to the space it claims.
 *
 * A geometry is unitless, so a shape tagged with the wrong space is otherwise
 * silent nonsense — a rectangle "in metres" whose box is `0.3 × 0.2` is a frame
 * shape, and a "frame" box sitting at `x = 40` is a pitch shape. The bounds are
 * deliberately loose: a shape may hang off the picture or reach past the
 * touchline, and refusing those would be wrong. What this rejects is a magnitude
 * that cannot be what it says.
 *
 * Returns the reason when it does not fit, so a caller can say something better
 * than "invalid".
 */
export function geometrySpaceProblem(
  geometry: Geometry,
  space: "frame" | "pitch",
  size: { lengthM: number; widthM: number } | null,
): string | null {
  const numbers = [geometry.x, geometry.y, geometry.w, geometry.h];
  if (!numbers.every((value) => Number.isFinite(value)))
    return "the geometry has a non-finite number";
  if (!Number.isFinite(geometry.rotation)) return "the geometry has a non-finite rotation";

  // A figure may sit half off the picture, so a frame box can legitimately reach
  // a little outside 0..1 — but never to metres.
  const FRAME_LIMIT = 1.5;
  const metres = Math.max(Math.abs(geometry.x), Math.abs(geometry.y));

  if (space === "frame") {
    if (metres > FRAME_LIMIT) {
      return `a box reaching ${metres.toFixed(2)} cannot be a fraction of a frame`;
    }
    return null;
  }

  // Pitch: within the pitch plus a margin, because a zone may be drawn a little
  // beyond the touchline on purpose. Without a pitch size there is nothing to
  // check against, and the shape is accepted rather than refused.
  if (size === null) return null;
  const margin = 12;
  const limitX = size.lengthM / 2 + margin;
  const limitY = size.widthM / 2 + margin;
  if (Math.abs(geometry.x) > limitX || Math.abs(geometry.y) > limitY) {
    return `a box at ${geometry.x.toFixed(1)}, ${geometry.y.toFixed(1)} m is off the pitch`;
  }
  return null;
}
