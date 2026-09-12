import { describe, expect, it } from "vitest";
import { fileNameOf, migrationList, splitStatements, unapplied } from "@/lib/db/migrate";
import { normalizeShortcut } from "@/lib/taxonomy/rules";
import { STARTER_TAXONOMY } from "@/lib/taxonomy/starter";

describe("migration runner helpers", () => {
  it("splits Drizzle output on its statement marker", () => {
    const sql = "CREATE TABLE a (id);\n--> statement-breakpoint\nCREATE TABLE b (id);";
    expect(splitStatements(sql)).toEqual(["CREATE TABLE a (id);", "CREATE TABLE b (id);"]);
  });

  it("drops empty fragments", () => {
    expect(splitStatements("SELECT 1;\n--> statement-breakpoint\n")).toEqual(["SELECT 1;"]);
  });

  it("reads the file name out of a glob path", () => {
    expect(fileNameOf("./migrations/0000_mean_blade.sql")).toBe("0000_mean_blade.sql");
  });

  it("reports what is still to apply", () => {
    const migrations = [{ name: "a.sql" }, { name: "b.sql" }, { name: "c.sql" }];
    expect(unapplied(migrations, ["a.sql"])).toEqual(["b.sql", "c.sql"]);
    expect(unapplied(migrations, ["a.sql", "b.sql", "c.sql"])).toEqual([]);
  });

  it("finds the generated migration in the bundle", () => {
    const list = migrationList();
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]?.name).toMatch(/^\d{4}_.*\.sql$/);
    expect(list[0]?.sql).toContain("CREATE TABLE");
  });
});

describe("starter taxonomy", () => {
  const tags = STARTER_TAXONOMY.flatMap((category) =>
    category.tags.map((tag) => ({ ...tag, category: category.name })),
  );

  it("covers attack, defence and transition", () => {
    expect(STARTER_TAXONOMY.map((category) => category.name)).toEqual([
      "ATTACK",
      "DEFENSE",
      "TRANSITION",
    ]);
  });

  it("binds each default key exactly once", () => {
    const keys = tags.map((tag) => tag.shortcutKey).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("only binds keys the rules accept", () => {
    for (const tag of tags) {
      if (!tag.shortcutKey) continue;
      expect(normalizeShortcut(tag.shortcutKey)).toBe(tag.shortcutKey);
    }
  });

  it("leaves some tags unbound, so the scheme is editable rather than forced", () => {
    expect(tags.some((tag) => !tag.shortcutKey)).toBe(true);
  });

  it("gives every category a colour", () => {
    for (const category of STARTER_TAXONOMY) {
      expect(category.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
