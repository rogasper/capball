/**
 * The annotation model (plans/technical-design-R1.md §5).
 *
 * Geometry is normalised to the video's **content rect**: `x` and `y` are
 * fractions of the frame's width and height, with the origin at the frame's
 * top-left. Nothing here knows about the window, the element, or the export
 * resolution, which is what lets one renderer serve the preview and the
 * burn-in (D17, D18).
 */

export const SHAPE_KINDS = [
  "arrow",
  "line",
  "rect",
  "ellipse",
  "polygon",
  "freehand",
  "text",
] as const;

export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** How long a shape is on screen (FR-20.4). */
export const WINDOW_MODES = ["moment", "event", "clip"] as const;
export type WindowMode = (typeof WINDOW_MODES)[number];

/**
 * Stroke width is a fraction of the frame **width** and font size a fraction of
 * the frame **height**, so a shape keeps its apparent weight when the same
 * drawing is rasterised at another resolution (NFR-27).
 */
export type AnnotationStyle = {
  stroke: string;
  fill: string | null;
  width: number;
  fontSize: number;
  opacity: number;
};

/**
 * An unrotated box plus the shape's own points.
 *
 * `points` are in the box's **unit square** (`0..1`), not in the frame: moving
 * or resizing a stroke is then a transform of the box rather than of every
 * point. When a box dimension is zero — a horizontal line, a vertical arrow —
 * the corresponding relative coordinate is `0` by definition (see
 * `absolutePoints`), which keeps the degenerate cases well defined.
 */
export type Geometry = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Radians, around the box centre. */
  rotation: number;
  points?: [number, number][];
};

/** An annotation as the UI and the renderer see it. */
export type Annotation = {
  id: number;
  uid: string;
  eventId: number;
  kind: ShapeKind;
  windowMode: WindowMode;
  windowMs: number;
  geometry: Geometry;
  style: AnnotationStyle;
  label: string | null;
  z: number;
};

/** The fields a new annotation needs; the store and the query layer add ids. */
export type AnnotationDraft = Omit<Annotation, "id">;

export const DEFAULT_STYLE: AnnotationStyle = {
  stroke: "#4C8DFF",
  fill: null,
  width: 0.0025,
  fontSize: 0.045,
  opacity: 1,
};

export function isShapeKind(value: string): value is ShapeKind {
  return (SHAPE_KINDS as readonly string[]).includes(value);
}

export function isWindowMode(value: string): value is WindowMode {
  return (WINDOW_MODES as readonly string[]).includes(value);
}

/**
 * Whether a value from outside the app — an imported file — is usable geometry.
 *
 * The query layer trusts what it wrote. A file from elsewhere does not get that
 * trust: a bad `geometry_json` would be read back on the next open and throw,
 * taking the event's whole drawing list with it, so an import checks first and
 * skips what it cannot use.
 */
export function isGeometry(value: unknown): value is Geometry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Geometry>;
  const numbers = [candidate.x, candidate.y, candidate.w, candidate.h, candidate.rotation];
  if (!numbers.every((number) => typeof number === "number" && Number.isFinite(number))) {
    return false;
  }
  if (candidate.points === undefined) return true;
  return (
    Array.isArray(candidate.points) &&
    candidate.points.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        point.every((number) => typeof number === "number" && Number.isFinite(number)),
    )
  );
}
