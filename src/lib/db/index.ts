import { migrate } from "./migrate";
import { seedStarterTaxonomy } from "./seed";

export type DatabaseInit = {
  migrationsRan: string[];
  seededTaxonomy: boolean;
};

/**
 * Brings the library database up to date. Safe to call on every launch:
 * migrations are recorded, and seeding only happens on an empty taxonomy.
 *
 * Concurrent callers share one run. React's StrictMode invokes the boot effect
 * twice in development, so without this two `migrate()` calls overlap — and the
 * second can drop a table in the window before the first recreates it. That
 * surfaces as `no such table` and a library that will not open, even though the
 * first call went on to finish correctly. It happened once, with `0002`.
 */
let initialization: Promise<DatabaseInit> | null = null;

export function initializeDatabase(): Promise<DatabaseInit> {
  initialization ??= (async () => {
    const migrationsRan = await migrate();
    const seededTaxonomy = await seedStarterTaxonomy();
    return { migrationsRan, seededTaxonomy };
  })().catch((error) => {
    // A failed boot must be retryable rather than cached forever.
    initialization = null;
    throw error;
  });

  return initialization;
}

export { db } from "./client";
export * from "./schema";
