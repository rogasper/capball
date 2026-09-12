import { describe, expect, it } from "vitest";
import {
  collectSubtreeIds,
  describeShortcutProblem,
  findShortcutConflict,
  normalizeShortcut,
  tagDeletionImpact,
} from "@/lib/taxonomy/rules";

describe("normalizeShortcut", () => {
  it("upper-cases single characters", () => {
    expect(normalizeShortcut("1")).toBe("1");
    expect(normalizeShortcut("q")).toBe("Q");
  });

  it("accepts function keys", () => {
    expect(normalizeShortcut("f5")).toBe("F5");
    expect(normalizeShortcut("F12")).toBe("F12");
    expect(normalizeShortcut("F13")).toBeNull();
  });

  it("refuses keys the transport already owns", () => {
    expect(normalizeShortcut(" ")).toBeNull();
    expect(normalizeShortcut("ArrowLeft")).toBeNull();
    expect(normalizeShortcut("Escape")).toBeNull();
  });
});

describe("describeShortcutProblem", () => {
  it("is silent for an acceptable key", () => {
    expect(describeShortcutProblem("7")).toBeNull();
  });

  it("names the conflict when a key belongs to playback", () => {
    expect(describeShortcutProblem("ArrowRight")).toMatch(/playback/i);
  });

  it("explains what is allowed otherwise", () => {
    expect(describeShortcutProblem("Ctrl+Shift+K")).toMatch(/single character/i);
  });
});

describe("findShortcutConflict", () => {
  const existing = [
    { id: 1, name: "High Press", shortcutKey: "1" },
    { id: 2, name: "Build Up", shortcutKey: "2" },
    { id: 3, name: "Recovery", shortcutKey: null },
  ];

  it("finds the tag already holding a key", () => {
    expect(findShortcutConflict(existing, "1")?.name).toBe("High Press");
  });

  it("ignores the tag being edited", () => {
    expect(findShortcutConflict(existing, "1", 1)).toBeNull();
  });

  it("is unmoved by case", () => {
    expect(findShortcutConflict(existing, "2")?.name).toBe("Build Up");
  });

  it("returns nothing for a free key", () => {
    expect(findShortcutConflict(existing, "9")).toBeNull();
  });
});

describe("tagDeletionImpact", () => {
  it("does not demand confirmation when nothing uses the tag", () => {
    const impact = tagDeletionImpact("Recovery", 0);
    expect(impact.requiresConfirmation).toBe(false);
    expect(impact.summary).toContain("No events");
  });

  it("states the count when events would be lost", () => {
    const impact = tagDeletionImpact("High Press", 17);
    expect(impact.requiresConfirmation).toBe(true);
    expect(impact.summary).toContain("17 events");
    expect(impact.summary).toContain("cannot be undone");
  });

  it("uses the singular for one event", () => {
    expect(tagDeletionImpact("Shot", 1).summary).toContain("1 event.");
  });
});

describe("collectSubtreeIds", () => {
  const tags = [
    { id: 1, parentId: null },
    { id: 2, parentId: 1 },
    { id: 3, parentId: 2 },
    { id: 4, parentId: null },
  ];

  it("includes the root and every descendant", () => {
    expect([...collectSubtreeIds(tags, 1)].sort()).toEqual([1, 2, 3]);
  });

  it("includes only the root for a leaf", () => {
    expect([...collectSubtreeIds(tags, 3)]).toEqual([3]);
  });

  it("stops at sibling branches", () => {
    expect(collectSubtreeIds(tags, 4).has(1)).toBe(false);
  });
});
