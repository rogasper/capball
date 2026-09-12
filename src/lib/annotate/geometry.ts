import type { Annotation, Geometry } from "./types";

/**
 * Pure geometry for annotations.
 *
 * Two coordinate spaces are in play and it matters which one a function is in:
 *
 * - **normalised frame coordinates** — `0..1` on both axes, origin at the top
 *   left of the video's picture. This is what is stored.
 * - **content-rect pixels** — the same space multiplied by the picture's size
 *   on screen. Hit tests and tolerances live here, because a tolerance is a
 *   number of pixels the user can actually see.
 *
 * Nothing in this file touches the DOM.
 */

export type Rect = { x: number; y: number; w: number; h: number };
export type Point = [number, number];

const EPS = 1e-6;

/** Resizing stops here rather than flipping the box inside out. */
export const MIN_SIZE = 0.004;

/**
 * The part of a `<video>` element the picture actually occupies.
 *
 * With `object-fit: contain` the element's box is not the video: the picture is
 * letterboxed inside it, and the letterbox depends on the window's aspect. Every
 * stored coordinate is relative to this rect, which is the only rectangle that
 * means the same thing at every window size and in an export.
 */
export function contentRect(
  elementW: number,
  elementH: number,
  videoW: number,
  videoH: number,
): Rect {
  if (videoW <= 0 || videoH <= 0 || elementW <= 0 || elementH <= 0) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }

  const scale = Math.min(elementW / videoW, elementH / videoH);
  const w = videoW * scale;
  const h = videoH * scale;
  return { x: (elementW - w) / 2, y: (elementH - h) / 2, w, h };
}

/** Pointer position in content-rect pixels → normalised frame coordinates. */
export function normalizePoint(rect: Rect, px: number, py: number): Point {
  if (rect.w <= 0 || rect.h <= 0) return [0, 0];
  return [(px - rect.x) / rect.w, (py - rect.y) / rect.h];
}

/** Normalised frame coordinates → content-rect pixels. */
export function denormalizePoint(rect: Rect, point: Point): Point {
  return [rect.x + point[0] * rect.w, rect.y + point[1] * rect.h];
}

export function boundsOfPoints(points: Point[]): { x: number; y: number; w: number; h: number } {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * A point's position inside a box, as `0..1` on each axis.
 *
 * A zero-width or zero-height box is the degenerate case of a horizontal line,
 * a vertical arrow, or a click-placed label. All its points share the box's own
 * origin on that axis, so the relative coordinate is `0` rather than a division
 * by zero — which is exactly what `absolutePoints` inverts.
 */
export function toRelative(
  point: Point,
  box: { x: number; y: number; w: number; h: number },
): Point {
  return [
    Math.abs(box.w) < EPS ? 0 : (point[0] - box.x) / box.w,
    Math.abs(box.h) < EPS ? 0 : (point[1] - box.y) / box.h,
  ];
}

/**
 * The shape's own points in normalised frame coordinates.
 *
 * Points are stored in the box's unit square so that moving or resizing a
 * stroke transforms the box, not every point (technical-design-R1 §5.3). The
 * multiplication is well defined for a zero-sized axis, so no guard is needed
 * here.
 */
export function absolutePoints(geometry: Geometry): Point[] {
  const points = geometry.points;
  if (!points) return [];
  return points.map((p) => [geometry.x + p[0] * geometry.w, geometry.y + p[1] * geometry.h]);
}

/** The shape's own points in content-rect pixels, including box rotation. */
export function absolutePointsPx(geometry: Geometry, rect: Rect): Point[] {
  const centre = boxCenterPx(geometry, rect);
  return absolutePoints(geometry).map((point) =>
    rotatePoint(denormalizePoint(rect, point), centre, geometry.rotation),
  );
}

export function boxCenterPx(geometry: Geometry, rect: Rect): Point {
  return [
    rect.x + (geometry.x + geometry.w / 2) * rect.w,
    rect.y + (geometry.y + geometry.h / 2) * rect.h,
  ];
}

export function rotatePoint(point: Point, origin: Point, angle: number): Point {
  if (Math.abs(angle) < EPS) return point;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point[0] - origin[0];
  const dy = point[1] - origin[1];
  return [origin[0] + dx * cos - dy * sin, origin[1] + dx * sin + dy * cos];
}

/** The four corners of the box in pixels, rotated about its centre. */
export function boxCornersPx(geometry: Geometry, rect: Rect): Point[] {
  const centre = boxCenterPx(geometry, rect);
  const left = rect.x + geometry.x * rect.w;
  const top = rect.y + geometry.y * rect.h;
  const right = left + geometry.w * rect.w;
  const bottom = top + geometry.h * rect.h;

  return (
    [
      [left, top],
      [right, top],
      [right, bottom],
      [left, bottom],
    ] as Point[]
  ).map((corner) => rotatePoint(corner, centre, geometry.rotation));
}

export type HandleName = "nw" | "ne" | "se" | "sw" | "p0" | "p1" | "rotate";

export type Handle = { name: HandleName; point: Point };

const ROTATE_HANDLE_OFFSET_PX = 26;

/**
 * The grab points for a selected shape.
 *
 * Lines and arrows get their endpoints, because dragging an endpoint is what a
 * user means by resizing a line. Text gets only the rotate handle, since its
 * size is a style (FR-20.5) rather than a box.
 */
export function handlesFor(annotation: Annotation, rect: Rect): Handle[] {
  const { geometry, kind } = annotation;

  if (annotation.kind === "line" || kind === "arrow") {
    const points = absolutePointsPx(geometry, rect);
    if (points.length === 2) {
      return [
        { name: "p0", point: points[0] },
        { name: "p1", point: points[1] },
        { name: "rotate", point: rotateHandle(geometry, rect) },
      ];
    }
  }

  const corners = boxCornersPx(geometry, rect);
  const resize: Handle[] =
    kind === "text"
      ? []
      : ([
          { name: "nw", point: corners[0] },
          { name: "ne", point: corners[1] },
          { name: "se", point: corners[2] },
          { name: "sw", point: corners[3] },
        ] as Handle[]);

  return [...resize, { name: "rotate", point: rotateHandle(geometry, rect) }];
}

function rotateHandle(geometry: Geometry, rect: Rect): Point {
  const centre = boxCenterPx(geometry, rect);
  const topMiddle: Point = [
    rect.x + (geometry.x + geometry.w / 2) * rect.w,
    rect.y + geometry.y * rect.h - ROTATE_HANDLE_OFFSET_PX,
  ];
  return rotatePoint(topMiddle, centre, geometry.rotation);
}

export function strokeWidthPx(annotation: Annotation, rect: Rect): number {
  return annotation.style.width * rect.w;
}

export function fontSizePx(annotation: Annotation, rect: Rect): number {
  return annotation.style.fontSize * rect.h;
}

/** An approximate label box, since text has no measured box until it is drawn. */
export function textBoxPx(annotation: Annotation, rect: Rect): Rect | null {
  if (annotation.kind !== "text" || !annotation.label) return null;
  const size = fontSizePx(annotation, rect);
  const base = denormalizePoint(rect, [annotation.geometry.x, annotation.geometry.y]);
  const w = size * 0.62 * annotation.label.length;
  return { x: base[0], y: base[1], w, h: size };
}

export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < EPS) return Math.hypot(point[0] - a[0], point[1] - a[1]);

  let t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
}

/** True when the point is inside a polygon (ray casting). */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const straddles = yi > point[1] !== yj > point[1];
    if (straddles && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Whether a click or press lands on the shape.
 *
 * The point is pulled back into the shape's unrotated frame first, so a rotated
 * shape is tested against its own axes rather than the screen's.
 */
export function hitTest(
  annotation: Annotation,
  pointPx: Point,
  rect: Rect,
  tolerancePx: number,
): boolean {
  const { geometry, kind } = annotation;
  const centre = boxCenterPx(geometry, rect);
  const local = rotatePoint(pointPx, centre, -geometry.rotation);
  const width = geometry.w * rect.w;
  const height = geometry.h * rect.h;
  const left = rect.x + geometry.x * rect.w;
  const top = rect.y + geometry.y * rect.h;
  const stroke = strokeWidthPx(annotation, rect);

  switch (kind) {
    case "rect": {
      const dx = Math.abs(local[0] - (left + width / 2));
      const dy = Math.abs(local[1] - (top + height / 2));
      return dx <= width / 2 + tolerancePx && dy <= height / 2 + tolerancePx;
    }
    case "ellipse": {
      const rx = Math.max(width / 2, EPS) + tolerancePx;
      const ry = Math.max(height / 2, EPS) + tolerancePx;
      const dx = (local[0] - (left + width / 2)) / rx;
      const dy = (local[1] - (top + height / 2)) / ry;
      return dx * dx + dy * dy <= 1;
    }
    case "text": {
      const box = textBoxPx(annotation, rect);
      if (!box) return false;
      return (
        local[0] >= box.x - tolerancePx &&
        local[0] <= box.x + box.w + tolerancePx &&
        local[1] >= box.y - tolerancePx &&
        local[1] <= box.y + box.h + tolerancePx
      );
    }
    case "line":
    case "arrow":
    case "freehand": {
      const points = absolutePointsPx(geometry, rect);
      const reach = tolerancePx + stroke / 2;
      for (let i = 0; i < points.length - 1; i++) {
        if (distanceToSegment(local, points[i], points[i + 1]) <= reach) return true;
      }
      return false;
    }
    case "polygon": {
      const points = absolutePointsPx(geometry, rect);
      if (points.length < 3) return false;
      if (annotation.style.fill && pointInPolygon(local, points)) return true;
      const reach = tolerancePx + stroke / 2;
      for (let i = 0; i < points.length; i++) {
        const next = points[(i + 1) % points.length];
        if (distanceToSegment(local, points[i], next) <= reach) return true;
      }
      return false;
    }
  }
}

export function moveBy(geometry: Geometry, du: number, dv: number): Geometry {
  return { ...geometry, x: geometry.x + du, y: geometry.y + dv };
}

/**
 * The geometry produced by dragging a handle to a new position.
 *
 * Corner handles scale the box and leave the shape's relative points alone, so
 * a stroke stretches with its box. Line endpoints move on their own and the box
 * is recomputed around them. Sizes clamp at `MIN_SIZE` rather than inverting,
 * which keeps a drag past the opposite corner from mirroring the shape.
 */
export function resizeBy(
  annotation: Annotation,
  handle: HandleName,
  toPx: Point,
  rect: Rect,
): Geometry {
  const { geometry, kind } = annotation;
  if (handle === "rotate") return geometry;

  const centre = boxCenterPx(geometry, rect);
  const local = rotatePoint(toPx, centre, -geometry.rotation);
  const target = normalizePoint(rect, local[0], local[1]);

  if ((kind === "line" || kind === "arrow") && (handle === "p0" || handle === "p1")) {
    const points = absolutePoints(geometry);
    if (points.length !== 2) return geometry;
    const next: Point[] = [points[0], points[1]];
    next[handle === "p0" ? 0 : 1] = target;
    const box = boundsOfPoints(next);
    return {
      ...box,
      rotation: geometry.rotation,
      points: [toRelative(next[0], box), toRelative(next[1], box)],
    };
  }

  const right = geometry.x + geometry.w;
  const bottom = geometry.y + geometry.h;

  // The corner opposite the grabbed one is the anchor, and the box is not
  // allowed to cross it: dragging past it collapses to MIN_SIZE at the anchor
  // rather than silently mirroring the shape to the other side.
  const anchorX = handle === "nw" || handle === "sw" ? right : geometry.x;
  const anchorY = handle === "nw" || handle === "ne" ? bottom : geometry.y;

  const growsLeft = handle === "nw" || handle === "sw";
  const growsUp = handle === "nw" || handle === "ne";

  const box = growsLeft
    ? {
        x: Math.min(target[0], anchorX - MIN_SIZE),
        w: anchorX - Math.min(target[0], anchorX - MIN_SIZE),
      }
    : { x: anchorX, w: Math.max(MIN_SIZE, target[0] - anchorX) };

  const vertical = growsUp
    ? {
        y: Math.min(target[1], anchorY - MIN_SIZE),
        h: anchorY - Math.min(target[1], anchorY - MIN_SIZE),
      }
    : { y: anchorY, h: Math.max(MIN_SIZE, target[1] - anchorY) };

  return { ...geometry, ...box, ...vertical };
}

/** The rotation implied by pointing at a position, keeping the box's centre. */
export function rotateTo(geometry: Geometry, pointerPx: Point, rect: Rect): Geometry {
  const centre = boxCenterPx(geometry, rect);
  const angle = Math.atan2(pointerPx[1] - centre[1], pointerPx[0] - centre[0]) + Math.PI / 2;
  return { ...geometry, rotation: angle };
}

/** A box for a shape dragged out between two points. */
export function boxGeometry(start: Point, end: Point): Geometry {
  const box = boundsOfPoints([start, end]);
  return { ...box, rotation: 0 };
}

/**
 * Geometry for a two-point shape.
 *
 * The box is the bounding rectangle and the endpoints are stored relative to it,
 * so which end the drag started from is preserved even when the stroke runs
 * right-to-left or bottom-to-top.
 */
export function twoPointGeometry(start: Point, end: Point): Geometry {
  const box = boundsOfPoints([start, end]);
  return {
    ...box,
    rotation: 0,
    points: [toRelative(start, box), toRelative(end, box)],
  };
}

/** Geometry for a stroke or a closed zone, with its points already simplified. */
export function pathGeometry(points: Point[]): Geometry {
  const box = boundsOfPoints(points);
  return {
    ...box,
    rotation: 0,
    points: points.map((point) => toRelative(point, box)),
  };
}

/**
 * Ramer–Douglas–Peucker.
 *
 * A freehand stroke arrives with one point per pointer event; keeping them all
 * would make one shape's point count larger than every other shape combined.
 * The tolerance is in normalised units, so it must be scaled by the caller from
 * a pixel budget.
 */
export function simplifyPath(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2 || tolerance <= 0) return [...points];

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  simplifyRange(points, 0, points.length - 1, tolerance, keep);

  return points.filter((_, index) => keep[index]);
}

function simplifyRange(
  points: Point[],
  first: number,
  last: number,
  tolerance: number,
  keep: boolean[],
): void {
  let farthest = -1;
  let maxDistance = 0;

  for (let i = first + 1; i < last; i++) {
    const distance = distanceToSegment(points[i], points[first], points[last]);
    if (distance > maxDistance) {
      maxDistance = distance;
      farthest = i;
    }
  }

  if (farthest === -1 || maxDistance <= tolerance) return;

  keep[farthest] = true;
  simplifyRange(points, first, farthest, tolerance, keep);
  simplifyRange(points, farthest, last, tolerance, keep);
}
