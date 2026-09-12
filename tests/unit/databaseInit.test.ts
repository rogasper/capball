import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The boot runs once, even when it is asked for twice at the same moment.
 *
 * React's StrictMode invokes the boot effect twice in development. Two
 * overlapping `migrate()` calls is not merely wasteful: the second can drop a
 * table in the window before the first recreates it, so the app reports
 * `no such table` and refuses to open the library while the first call goes on
 * to finish correctly — a failure that looks permanent and is not.
 */

const mocks = vi.hoisted(() => ({
  migrate: vi.fn(),
  seed: vi.fn(),
}));

vi.mock("@/lib/db/migrate", () => ({ migrate: mocks.migrate }));
vi.mock("@/lib/db/seed", () => ({ seedStarterTaxonomy: mocks.seed }));

async function freshDatabaseModule() {
  vi.resetModules();
  return import("@/lib/db");
}

beforeEach(() => {
  mocks.migrate.mockReset();
  mocks.seed.mockReset();
  mocks.migrate.mockResolvedValue(["0002_annotations_r1.sql"]);
  mocks.seed.mockResolvedValue(true);
});

describe("initializeDatabase", () => {
  it("shares one boot between callers that arrive together", async () => {
    const { initializeDatabase } = await freshDatabaseModule();

    const first = initializeDatabase();
    const second = initializeDatabase();

    expect(second).toBe(first);
    await expect(first).resolves.toEqual({
      migrationsRan: ["0002_annotations_r1.sql"],
      seededTaxonomy: true,
    });
    expect(mocks.migrate).toHaveBeenCalledTimes(1);
  });

  it("keeps the finished boot for later callers instead of repeating it", async () => {
    const { initializeDatabase } = await freshDatabaseModule();

    const first = initializeDatabase();
    await first;
    const later = initializeDatabase();

    // Boot happens once per session: a second caller reuses the result rather
    // than migrating and seeding again.
    expect(later).toBe(first);
    await later;
    expect(mocks.migrate).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failure, so the next launch can retry", async () => {
    mocks.migrate.mockRejectedValueOnce(new Error("no such table: annotations"));
    const { initializeDatabase } = await freshDatabaseModule();

    await expect(initializeDatabase()).rejects.toThrow(/no such table/);
    await expect(initializeDatabase()).resolves.toBeTruthy();
    expect(mocks.migrate).toHaveBeenCalledTimes(2);
  });
});
