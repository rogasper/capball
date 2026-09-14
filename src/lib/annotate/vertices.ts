import {
  boundsOfPoints,
  type HandleName,
  midpointIndexOf,
  type Point,
  shapeVertices,
  toRelative,
  vertexIndexOf,
} from "./geometry";
import type { Annotation, Geometry, ShapeKind } from "./types";

/**
 * Reshaping a shape corner by corner (FR-20.11, R2).
 *
 * R1 could move, resize and rotate a shape but never change what it *is*: a
 * rectangle stayed a rectangle. These functions turn a shape into an ordered
 * list of vertices and back, so a corner can be removed — which is how a
 * rectangle becomes the triangle three players actually formed — and inserted.
 *
 * Three invariants, each of them a test:
 *
 * 1. **Order is the shape.** Removing a vertex closes the outline over the ones
 *    that remain, in order, with no stray segment.
 * 2. **An edit changes the kind only when the count changes.** So a rectangle
 *    that is reshaped is stored as a polygon from then on (FR-20.11), while a
 *    polygon that merely has a vertex dragged stays a polygon.
 * 3. **Nothing else about the shape moves.** Style, label, time window and layer
 *    are the caller's business; these functions return geometry and kind only.
 *
 * The conversion goes through the shape's **bounding box** rather than keeping a
 * vertex list: `points` are stored in the box's unit square (R1 §5.3), so moving
 * one vertex while the others stay put means recomputing the box around the
 * whole set and re-expressing every point against it.
 */

/** Beyond this a reshaped shape stops being a drawing and starts being a mess. */
export const MAX_VERTICES = 100;

const EDITABLE: readonly ShapeKind[] = ["rect", "polygon", "line", "arrow"];
const ADDABLE: readonly ShapeKind[] = ["rect", "polygon"];

/** A shape whose vertices can be moved. A rectangle is edited by its box. */
export function canEditVertices(kind: ShapeKind): boolean {
  return EDITABLE.includes(kind);
}

/**
 * A shape a vertex can be added to.
 *
 * A line or an arrow is deliberately excluded: inserting a point into a
 * two-point shape would have to close it, turning a line into a triangle the
 * user never drew. Two points is what makes a line a line.
 */
export function canAddVertices(kind: ShapeKind): boolean {
  return ADDABLE.includes(kind);
}

/** Whether dragging a vertex is a reshape (true) or the box resize (false). */
export function dragsSingleVertex(kind: ShapeKind): boolean {
  return kind === "polygon" || kind === "line" || kind === "arrow";
}

/**
 * The shape's vertices in order, in normalised frame coordinates.
 *
 * The definition lives in `geometry.ts` beside the handle layer, so "vertex 2"
 * means the same point to the drag, the removal and the drawn handle.
 */
export function vertexList(annotation: Annotation): Point[] {
  return shapeVertices(annotation.geometry, annotation.kind);
}

/** A geometry and kind built from an ordered vertex list. */
function fromVertices(vertices: Point[], rotation: number, kind: ShapeKind): ShapeEdit {
  const box = boundsOfPoints(vertices);
  const geometry: Geometry = {
    ...box,
    rotation,
    points: vertices.map((vertex) => toRelative(vertex, box)),
  };
  return { kind, geometry };
}

export type ShapeEdit = { kind: ShapeKind; geometry: Geometry };

/**
 * Moves one vertex, leaving every other vertex where it is.
 *
 * Returns `null` for a shape whose vertices are not dragged individually — a
 * rectangle, whose corner drag is the box resize R1 already had, and the shapes
 * with no vertices at all.
 */
export function moveVertex(annotation: Annotation, index: number, to: Point): ShapeEdit | null {
  const { kind, geometry } = annotation;
  if (!dragsSingleVertex(kind)) return null;

  const vertices = vertexList(annotation);
  if (index < 0 || index >= vertices.length) return null;

  const next = vertices.map((vertex, at) => (at === index ? to : vertex));
  return fromVertices(next, geometry.rotation, kind);
}

/**
 * Removes one vertex, closing the outline over the rest.
 *
 * `null` when the shape cannot lose a vertex: a two-point line has none to
 * spare, and a rectangle's four corners are its definition until one is removed,
 * which is the case this function exists for — the result is a polygon, so a
 * rectangle minus a corner is a triangle.
 */
export function removeVertex(annotation: Annotation, index: number): ShapeEdit | null {
  const { kind, geometry } = annotation;
  if (!canEditVertices(kind)) return null;

  const vertices = vertexList(annotation);
  if (index < 0 || index >= vertices.length) return null;

  const remaining = vertices.filter((_, at) => at !== index);
  if (remaining.length < 2) return null;

  // Three vertices is the fewest that can still enclose an area. Below that the
  // shape is a line by definition, and it is stored as one rather than as a
  // degenerate polygon the renderer would close into a sliver.
  const nextKind: ShapeKind = remaining.length < 3 ? "line" : "polygon";
  return fromVertices(remaining, geometry.rotation, nextKind);
}

/**
 * Inserts a vertex after `index`, on the edge it splits.
 *
 * A rectangle becomes a polygon with five vertices, keeping every original
 * corner; a polygon gains a point. `at` is normally the midpoint of the edge, so
 * the new vertex sits on the outline the user already sees.
 */
export function insertVertex(annotation: Annotation, index: number, at: Point): ShapeEdit | null {
  const { kind, geometry } = annotation;
  if (!canAddVertices(kind)) return null;

  const vertices = vertexList(annotation);
  if (index < 0 || index >= vertices.length) return null;
  if (vertices.length >= MAX_VERTICES) return null;

  const next = [...vertices];
  next.splice(index + 1, 0, at);
  return fromVertices(next, geometry.rotation, "polygon");
}

/** The midpoint of the edge that starts at `index`, in normalised coordinates. */
export function edgeMidpoint(annotation: Annotation, index: number): Point | null {
  const vertices = vertexList(annotation);
  if (index < 0 || index >= vertices.length) return null;
  const from = vertices[index];
  const to = vertices[(index + 1) % vertices.length];
  if (!to) return null;
  return [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
}

/** How many vertices a shape has, for the handle layer and its labels. */
export function vertexCount(annotation: Annotation): number {
  return vertexList(annotation).length;
}

/**
 * A rectangle's resize corners double as its vertices, in the order
 * `shapeVertices` and `boxCornersPx` both use.
 *
 * Shared so the frame canvas and the pitch view agree about which corner is
 * "vertex 2" — the pitch view hands M12's toolkit a rect whose units are metres,
 * and the mapping has to be the same one.
 */
const RECT_CORNER_INDEX: Partial<Record<HandleName, number>> = { nw: 0, ne: 1, se: 2, sw: 3 };

/**
 * The vertex a grip would remove, or `null` when that grip only moves something.
 *
 * A polygon vertex and a rectangle corner are both removable; a midpoint grip
 * adds a corner, and a line's endpoint has none to spare.
 */
export function removableVertexFor(
  name: HandleName,
  annotation: Annotation | undefined,
): number | null {
  const vertex = vertexIndexOf(name);
  if (vertex !== null) return vertex;
  const corner = RECT_CORNER_INDEX[name];
  if (corner !== undefined && annotation?.kind === "rect") return corner;
  return null;
}

/** What a grip is, in words — including the gesture that is invisible until named. */
export function handleLabel(name: HandleName, annotation: Annotation | undefined): string {
  const vertex = vertexIndexOf(name);
  if (vertex !== null) {
    const total = annotation ? vertexCount(annotation) : 0;
    return `Corner ${vertex + 1} of ${total} — drag to move, Delete to remove`;
  }
  if (midpointIndexOf(name) !== null) return "Add a corner on this edge";

  return FIXED_HANDLE_LABELS[name] ?? "Handle";
}

const FIXED_HANDLE_LABELS: Record<string, string> = {
  nw: "Resize from top left — Delete removes this corner",
  ne: "Resize from top right — Delete removes this corner",
  se: "Resize from bottom right — Delete removes this corner",
  sw: "Resize from bottom left — Delete removes this corner",
  p0: "Move start point",
  p1: "Move end point",
  rotate: "Rotate",
};
