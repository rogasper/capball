import { describe, expect, it } from "vitest";
import { STROKE_PATTERNS } from "@/lib/annotate/types";
import {
  dashUnits,
  STROKE_PATTERN_LABELS,
  strokeDash,
  strokePreviewPath,
} from "@/lib/render/stroke";

/**
 * The line styles (FR-20.14).
 *
 * The property that matters is not the numbers themselves but their *units*: a
 * dash measured in stroke widths is the only reason the preview and a 1080p clip
 * show the same rhythm, and that is what most of these assert.
 */

describe("dash patterns", () => {
  it("has a pattern for every style the UI offers, and a solid one is empty", () => {
    for (const pattern of STROKE_PATTERNS) {
      expect(dashUnits(pattern)).toBeDefined();
      expect(STROKE_PATTERN_LABELS[pattern].length).toBeGreaterThan(0);
    }
    expect(dashUnits("solid")).toEqual([]);
  });

  it("gives the four styles four different rhythms", () => {
    const rhythms = STROKE_PATTERNS.map((pattern) => dashUnits(pattern).join(","));
    expect(new Set(rhythms).size).toBe(STROKE_PATTERNS.length);
  });

  it("measures the dash in stroke widths, so the export keeps the rhythm", () => {
    // A 2 px preview line and a 4 px export line of the same shape: the export's
    // dashes are exactly twice as long, which is what makes them look identical.
    expect(strokeDash("dashed", 2)).toEqual([8, 6]);
    expect(strokeDash("dashed", 4)).toEqual([16, 12]);
  });

  it("never lets a very thin line turn its dashes into a grey smear", () => {
    // Below one pixel the smallest honest unit is a pixel, not a fraction.
    expect(strokeDash("dotted", 0.4)).toEqual([1, 2]);
  });

  it("passes solid through as an empty array, which is what the canvas wants", () => {
    expect(strokeDash("solid", 12)).toEqual([]);
  });

  it("draws a preview at the same relationship the canvas uses", () => {
    const dashed = strokePreviewPath("dashed", 2);
    expect(dashed.dash).toBe("8 6");
    expect(dashed.strokeWidth).toBe(2);
    expect(strokePreviewPath("solid").dash).toBeNull();
  });
});
