import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tagCategories, tags } from "@/lib/db/schema";
import { execute, select } from "@/lib/ipc/database";
import { normalizeShortcut } from "@/lib/taxonomy/rules";

export type TagCategory = typeof tagCategories.$inferSelect;
export type Tag = typeof tags.$inferSelect;

export async function listCategories(): Promise<TagCategory[]> {
  return db
    .select()
    .from(tagCategories)
    .orderBy(asc(tagCategories.sortOrder), asc(tagCategories.name));
}

export async function listTags(): Promise<Tag[]> {
  return db.select().from(tags).orderBy(asc(tags.sortOrder), asc(tags.name));
}

export async function createCategory(name: string, color?: string | null): Promise<TagCategory> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A category needs a name.");

  const existing = await db
    .select()
    .from(tagCategories)
    .where(eq(tagCategories.name, trimmed))
    .limit(1);
  if (existing[0]) return existing[0];

  const [row] = await db
    .insert(tagCategories)
    .values({ name: trimmed, color: color ?? null })
    .returning();
  return row;
}

export async function renameCategory(id: number, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A category needs a name.");
  await db.update(tagCategories).set({ name: trimmed }).where(eq(tagCategories.id, id));
}

/** Deleting a category removes its tags, and therefore their events. */
export async function deleteCategory(id: number): Promise<void> {
  await db.delete(tagCategories).where(eq(tagCategories.id, id));
}

export async function createTag(input: {
  categoryId: number;
  parentId?: number | null;
  name: string;
  color?: string | null;
  shortcutKey?: string | null;
}): Promise<Tag> {
  const name = input.name.trim();
  if (!name) throw new Error("A tag needs a name.");

  const [row] = await db
    .insert(tags)
    .values({
      categoryId: input.categoryId,
      parentId: input.parentId ?? null,
      name,
      color: input.color ?? null,
      shortcutKey: input.shortcutKey ? normalizeShortcut(input.shortcutKey) : null,
    })
    .returning();
  return row;
}

export async function updateTag(
  id: number,
  patch: {
    name?: string;
    color?: string | null;
    shortcutKey?: string | null;
    parentId?: number | null;
    sortOrder?: number;
  },
): Promise<void> {
  const values: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (!trimmed) throw new Error("A tag needs a name.");
    values.name = trimmed;
  }
  if (patch.color !== undefined) values.color = patch.color;
  if (patch.shortcutKey !== undefined) {
    values.shortcutKey = patch.shortcutKey ? normalizeShortcut(patch.shortcutKey) : null;
  }
  if (patch.parentId !== undefined) values.parentId = patch.parentId;
  if (patch.sortOrder !== undefined) values.sortOrder = patch.sortOrder;

  if (Object.keys(values).length === 0) return;
  await db.update(tags).set(values).where(eq(tags.id, id));
}

/**
 * Deletes the tag, its descendants, and their events — one statement, so the
 * cascade is atomic. The confirmation that protects the user lives in the UI;
 * see `tagDeletionImpact`.
 */
export async function deleteTag(id: number): Promise<void> {
  await db.delete(tags).where(eq(tags.id, id));
}

const SUBTREE = `WITH RECURSIVE subtree(id) AS (
  SELECT id FROM tags WHERE id = ?
  UNION ALL
  SELECT child.id FROM tags child JOIN subtree parent ON child.parent_id = parent.id
)`;

/** How many events the tag and its descendants own (FR-4.1). */
export async function countEventsForTagSubtree(tagId: number): Promise<number> {
  const rows = await select(
    `${SUBTREE} SELECT COUNT(*) AS n FROM events WHERE tag_id IN (SELECT id FROM subtree)`,
    [tagId],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Moves every event of the tag's subtree to another tag. Returns the count moved. */
export async function reassignTagEvents(fromTagId: number, toTagId: number): Promise<number> {
  if (fromTagId === toTagId) return 0;

  const moving = await countEventsForTagSubtree(fromTagId);
  if (moving === 0) return 0;

  // Parameter order follows the statement: the subtree root first, then the
  // destination tag.
  await execute(
    `${SUBTREE} UPDATE events SET tag_id = ?, updated_at = unixepoch()
     WHERE tag_id IN (SELECT id FROM subtree)`,
    [fromTagId, toTagId],
  );
  return moving;
}
