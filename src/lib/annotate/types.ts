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
 * How a shape's fill is painted (FR-20.12, R2).
 *
 * `hatch` and `crossHatch` are generated from the shape's geometry at draw time
 * rather than tiled from an image, so the pattern stays crisp at any export
 * resolution and the app and the file cannot diverge (ADR 0009). `fill: null`
 * still means "no fill at all", which is how an outline-only zone is drawn.
 */
export const FILL_PATTERNS = ["solid", "hatch", "crossHatch"] as const;
export type FillPattern = (typeof FILL_PATTERNS)[number];

/**
 * How a **stroke** is painted (FR-20.14, R2).
 *
 * In football notation the line style is the vocabulary: solid for the ball
 * played, dashed for a player's run, dotted for a carry, dash-dot for pressure.
 * It is a style rather than a shape kind because every one of them is the same
 * geometry, and because the dash is measured in stroke widths it renders the
 * same in the preview and in the export (D17's rule, applied to the dash).
 */
export const STROKE_PATTERNS = ["solid", "dashed", "dotted", "dashDot"] as const;
export type StrokePattern = (typeof STROKE_PATTERNS)[number];

export function isStrokePattern(value: unknown): value is StrokePattern {
  return typeof value === "string" && (STROKE_PATTERNS as readonly string[]).includes(value);
}

/** Hatch spacing as a fraction of the picture's width, and the line angle. */
export const DEFAULT_PATTERN_SCALE = 0.02;
export const DEFAULT_PATTERN_ANGLE = -Math.PI / 4;

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
  fillPattern: FillPattern;
  /** Fraction of the picture width, like `width`, so it scales with the export. */
  patternScale: number;
  /** Radians, counter-clockwise from the horizontal. */
  patternAngle: number;
  /** The line's own pattern (FR-20.14); `solid` is every style written before R2. */
  strokePattern: StrokePattern;
};

/**
 * An unrotated box plus the shape's own points.
 *
 * `points` are in the box's **unit square** (`0..1`), not in the frame: moving
 * or resizing a stroke is then a transform of the box rather than of every
 * point. When a box dimension is zero — a horizontal line, a vertical arrow —
 * the corresponding relative coordinate is `0` by definition (see
 * `absolutePoints`), which keeps the degenerate cases well defined.
 *
 * `space` says what the box's **units** mean (R2, FR-80). It lives in the
 * geometry rather than in a column because that is what it qualifies, and
 * because SQLite cannot add a column idempotently — so a column would have
 * needed a table rebuild, which this project's rule 9 forbids for a table that
 * holds data (ADR 0008). Absent means `frame`, which is every R1 row.
 */
export type Geometry = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Radians, around the box centre. */
  rotation: number;
  points?: [number, number][];
  space?: AnnotationSpace;
};

/**
 * What a shape's numbers are measured against.
 *
 * `frame` is R1: fractions of the video's content rect, fixed to the pixels they
 * were drawn on. `pitch` is R2: metres from the pitch centre, projected into the
 * camera's perspective at draw time, so a corrected calibration moves the shape
 * (FR-80.2, FR-80.3).
 */
export const ANNOTATION_SPACES = ["frame", "pitch"] as const;
export type AnnotationSpace = (typeof ANNOTATION_SPACES)[number];

export function isAnnotationSpace(value: unknown): value is AnnotationSpace {
  return typeof value === "string" && (ANNOTATION_SPACES as readonly string[]).includes(value);
}

/** The range a drawing is on screen for, or null when it follows its event. */
export function ownWindowOf(annotation: Annotation): TimeWindow | null {
  const window = annotation.ownWindow;
  if (!window) return null;
  const startMs = Math.round(window.startMs);
  const endMs = Math.round(window.endMs);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return endMs >= startMs ? { startMs, endMs } : { startMs: endMs, endMs: startMs };
}

/** The space a geometry is in, defaulting to the frame for every R1 row. */
export function spaceOf(geometry: Geometry): AnnotationSpace {
  return isAnnotationSpace(geometry.space) ? geometry.space : "frame";
}

/**
 * A span of footage. Kept here rather than in `window.ts` so an annotation can
 * carry one without the two modules importing each other.
 */
export type TimeWindow = { startMs: number; endMs: number };

/** An annotation as the UI and the renderer see it. */
export type Annotation = {
  id: number;
  uid: string;
  eventId: number;
  kind: ShapeKind;
  windowMode: WindowMode;
  windowMs: number;
  /**
   * The span this drawing is on screen for, when it has one of its own
   * (FR-20.16). A row in `annotation_windows` rather than a column, and its
   * presence wins over `windowMode` — so `windowMode` keeps its R1 values and a
   * drawing without a range behaves exactly as it did before this existed.
   *
   * Optional, like `geometry.space`: absent means "no range of its own", which is
   * every drawing written before this release, and it is read through
   * `ownWindowOf` rather than directly.
   */
  ownWindow?: TimeWindow | null;
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
  fillPattern: "solid",
  patternScale: DEFAULT_PATTERN_SCALE,
  patternAngle: DEFAULT_PATTERN_ANGLE,
  strokePattern: "solid",
};

export function isFillPattern(value: unknown): value is FillPattern {
  return typeof value === "string" && (FILL_PATTERNS as readonly string[]).includes(value);
}

/**
 * A style from storage or an import, made safe to draw with.
 *
 * R1 rows carry no pattern fields, and they must keep rendering exactly as they
 * did: the spread of the defaults is what makes an old shape solid rather than
 * undefined. A pattern value that is not one of the three is treated as solid
 * rather than trusted, because a bad string would reach the renderer as a
 * pattern it cannot generate.
 */
export function normaliseStyle(
  partial: Partial<AnnotationStyle> | null | undefined,
): AnnotationStyle {
  const merged = { ...DEFAULT_STYLE, ...(partial ?? {}) };
  const finite = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;

  return {
    ...merged,
    fillPattern: isFillPattern(merged.fillPattern) ? merged.fillPattern : "solid",
    strokePattern: isStrokePattern(merged.strokePattern) ? merged.strokePattern : "solid",
    patternScale: Math.max(0.002, finite(merged.patternScale, DEFAULT_PATTERN_SCALE)),
    patternAngle: finite(merged.patternAngle, DEFAULT_PATTERN_ANGLE),
  };
}

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
  if (candidate.space !== undefined && !isAnnotationSpace(candidate.space)) return false;
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
