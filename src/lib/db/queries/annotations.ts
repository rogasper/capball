import { and, asc, eq, sql } from "drizzle-orm";
import {
  type Annotation,
  type AnnotationStyle,
  type Geometry,
  isShapeKind,
  isWindowMode,
  normaliseStyle,
} from "@/lib/annotate/types";
import { db } from "@/lib/db/client";
import { annotations } from "@/lib/db/schema";

/**
 * Annotations are stored as rows with two JSON columns.
 *
 * A polygon has N points, an arrow has two, text has a label and a font size,
 * and nothing in R1 queries inside a shape — annotations are always read by
 * `event_id`. The columns that *are* filtered on (`event_id`, `kind`,
 * `window_mode`) are real columns.
 *
 * Reading is strict rather than forgiving: a row whose JSON cannot be
 * understood throws with the row's id, because a silently dropped drawing is
 * worse than a visible failure (AGENTS.md: no silent catches).
 */

export class AnnotationDecodeError extends Error {
  constructor(id: number, field: string) {
    super(`Annotation ${id} has an unreadable ${field}. The row is corrupt.`);
    this.name = "AnnotationDecodeError";
  }
}

export type NewAnnotation = {
  uid: string;
  eventId: number;
  kind: string;
  windowMode: string;
  windowMs: number;
  geometry: Geometry;
  style: AnnotationStyle;
  label: string | null;
  z: number;
};

function decodeJson<T>(id: number, field: string, raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new AnnotationDecodeError(id, field);
  }
}

function toAnnotation(row: typeof annotations.$inferSelect): Annotation {
  if (!isShapeKind(row.kind)) {
    throw new AnnotationDecodeError(row.id, "kind");
  }

  return {
    id: row.id,
    uid: row.uid,
    eventId: row.eventId,
    kind: row.kind,
    windowMode: isWindowMode(row.windowMode) ? row.windowMode : "moment",
    windowMs: row.windowMs,
    geometry: decodeJson<Geometry>(row.id, "geometry", row.geometryJson),
    // R1 rows carry no pattern fields, and `normaliseStyle` is what makes them
    // render as solid: a merged default rather than an undefined pattern.
    style: normaliseStyle(decodeJson<Partial<AnnotationStyle>>(row.id, "style", row.styleJson)),
    label: row.label,
    z: row.z,
  };
}

export async function listAnnotations(eventId: number): Promise<Annotation[]> {
  const rows = await db
    .select()
    .from(annotations)
    .where(eq(annotations.eventId, eventId))
    .orderBy(asc(annotations.z), asc(annotations.id));

  return rows.map(toAnnotation);
}

export async function createAnnotation(input: NewAnnotation): Promise<Annotation> {
  const [row] = await db
    .insert(annotations)
    .values({
      uid: input.uid,
      eventId: input.eventId,
      kind: input.kind,
      windowMode: input.windowMode,
      windowMs: Math.round(input.windowMs),
      geometryJson: JSON.stringify(input.geometry),
      styleJson: JSON.stringify(input.style),
      label: input.label,
      z: input.z,
    })
    .returning();

  return toAnnotation(row);
}

async function update(id: number, patch: Partial<typeof annotations.$inferInsert>): Promise<void> {
  await db
    .update(annotations)
    .set({ ...patch, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(annotations.id, id));
}

export async function updateAnnotationGeometry(id: number, geometry: Geometry): Promise<void> {
  await update(id, { geometryJson: JSON.stringify(geometry) });
}

/**
 * Writes a shape's kind and geometry together.
 *
 * Reshaping changes both at once — a rectangle minus a corner is a polygon — and
 * splitting that across two statements would leave a row that is briefly a
 * polygon with a rectangle's points, or the reverse, if the second one failed.
 */
export async function updateAnnotationShape(
  id: number,
  kind: string,
  geometry: Geometry,
): Promise<void> {
  await update(id, { kind, geometryJson: JSON.stringify(geometry) });
}

export async function updateAnnotationStyle(id: number, style: AnnotationStyle): Promise<void> {
  await update(id, { styleJson: JSON.stringify(style) });
}

export async function updateAnnotationWindow(
  id: number,
  windowMode: string,
  windowMs: number,
): Promise<void> {
  await update(id, { windowMode, windowMs: Math.round(windowMs) });
}

export async function updateAnnotationLabel(id: number, label: string | null): Promise<void> {
  await update(id, { label });
}

export async function deleteAnnotation(id: number): Promise<void> {
  await db.delete(annotations).where(eq(annotations.id, id));
}

/** How many drawings an event would take with it (FR-20.6). */
export async function countAnnotations(eventId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)`.as("annotation_count") })
    .from(annotations)
    .where(eq(annotations.eventId, eventId));
  return Number(row?.count ?? 0);
}

/**
 * Rewrites the paint order of one event's annotations.
 *
 * The event is part of the predicate, not just the ids, so a stale list cannot
 * renumber a different event's drawings.
 */
export async function reorderAnnotations(eventId: number, orderedIds: number[]): Promise<void> {
  const stamp = Math.floor(Date.now() / 1000);
  await Promise.all(
    orderedIds.map((id, index) =>
      db
        .update(annotations)
        .set({ z: index, updatedAt: stamp })
        .where(and(eq(annotations.id, id), eq(annotations.eventId, eventId))),
    ),
  );
}
