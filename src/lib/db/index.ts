import { migrate } from "./migrate";
import { seedStarterTaxonomy } from "./seed";

export type DatabaseInit = {
  migrationsRan: string[];
  seededTaxonomy: boolean;
};

/**
 * Brings the library database up to date. Safe to call on every launch:
 * migrations are recorded, and seeding only happens on an empty taxonomy.
 */
export async function initializeDatabase(): Promise<DatabaseInit> {
  const migrationsRan = await migrate();
  const seededTaxonomy = await seedStarterTaxonomy();
  return { migrationsRan, seededTaxonomy };
}

export { db } from "./client";
export * from "./schema";
