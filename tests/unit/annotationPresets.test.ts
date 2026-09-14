import { describe, expect, it } from "vitest";
import { presetByKey, STROKE_PRESETS, stylePatchOf } from "@/lib/annotate/presets";
import { STROKE_PATTERNS } from "@/lib/annotate/types";

/**
 * The notation, as data (FR-20.14).
 *
 * A preset is not a new kind of object: it is a named set of values that already
 * exist. These tests are about it staying that way — a preset that reached into
 * the fill, or that needed a schema of its own, would be a different (and much
 * more expensive) design.
 */

describe("the named strokes", () => {
  it("offers the four movements the notation needs, and cover besides", () => {
    expect(STROKE_PRESETS.map((preset) => preset.key)).toEqual([
      "pass",
      "run",
      "dribble",
      "press",
      "cover",
    ]);
  });

  it("tells every preset apart by its line style, not by its colour", () => {
    // NFR-24's rule applied to lines: two presets must not differ by hue alone,
    // or the drawing stops meaning anything with colour removed.
    const strokes = STROKE_PRESETS.map((preset) => `${preset.pattern}:${preset.tool}`);
    expect(new Set(strokes).size).toBe(STROKE_PRESETS.length);
  });

  it("uses only patterns the style model has", () => {
    for (const preset of STROKE_PRESETS) {
      expect(STROKE_PATTERNS).toContain(preset.pattern);
    }
  });

  it("is drawn with a stroke tool, never a filled shape", () => {
    for (const preset of STROKE_PRESETS) {
      expect(["arrow", "line"]).toContain(preset.tool);
    }
  });

  it("sets stroke fields only, so restyling a zone cannot flatten its fill", () => {
    for (const preset of STROKE_PRESETS) {
      expect(Object.keys(stylePatchOf(preset)).sort()).toEqual([
        "stroke",
        "strokePattern",
        "width",
      ]);
    }
  });

  it("says what each one means, because that is what makes it informative", () => {
    for (const preset of STROKE_PRESETS) {
      expect(preset.meaning.length).toBeGreaterThan(10);
      expect(preset.label.length).toBeGreaterThan(2);
    }
  });

  it("finds a preset by key, and nothing for an unknown one", () => {
    expect(presetByKey("press")?.pattern).toBe("dashDot");
    expect(presetByKey("no-such-stroke")).toBeUndefined();
  });
});
