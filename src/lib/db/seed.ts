import { db } from "@/lib/db/client";
import { tagCategories, tags } from "@/lib/db/schema";
import { STARTER_TAXONOMY } from "@/lib/taxonomy/starter";

/**
 * Seeds the standard football vocabulary on first run (FR-4.3).
 *
 * Runs only when there are no categories at all, so a user who deleted the
 * starter set does not get it back on every launch.
 */
export async function seedStarterTaxonomy(): Promise<boolean> {
  const existing = await db.select({ id: tagCategories.id }).from(tagCategories).limit(1);
  if (existing.length > 0) return false;

  let categoryOrder = 0;
  for (const category of STARTER_TAXONOMY) {
    const [row] = await db
      .insert(tagCategories)
      .values({
        name: category.name,
        color: category.color,
        sortOrder: categoryOrder,
      })
      .returning({ id: tagCategories.id });
    categoryOrder += 1;

    let tagOrder = 0;
    for (const tag of category.tags) {
      await db.insert(tags).values({
        categoryId: row.id,
        name: tag.name,
        shortcutKey: tag.shortcutKey ?? null,
        sortOrder: tagOrder,
      });
      tagOrder += 1;
    }
  }

  return true;
}
