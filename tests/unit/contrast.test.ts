import { describe, expect, it } from "vitest";
import { CHIP_TEXT_COLOURS, readableTextOn, relativeLuminance } from "@/lib/render/contrast";

/**
 * A label's text colour, derived rather than assumed (FR-20.15).
 *
 * The palette has light yellows as well as deep blues, so white-on-yellow is a
 * real possibility — and NFR-34 says a cue must not depend on luck.
 */

describe("relative luminance", () => {
  it("reads black as nothing and white as everything", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 6);
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 6);
  });

  it("accepts the three-digit form", () => {
    expect(relativeLuminance("#FFF")).toBeCloseTo(1, 6);
  });

  it("weighs green more than blue, which is what makes a mid-tone readable", () => {
    const green = relativeLuminance("#00FF00") ?? 0;
    const blue = relativeLuminance("#0000FF") ?? 0;
    expect(green).toBeGreaterThan(blue);
  });

  it("returns null for a colour it cannot read", () => {
    expect(relativeLuminance("var(--accent)")).toBeNull();
    expect(relativeLuminance("rgb(1,2,3)")).toBeNull();
    expect(relativeLuminance("#12345")).toBeNull();
  });
});

describe("the text colour a chip uses", () => {
  it("puts dark text on a light shape", () => {
    expect(readableTextOn("#FBBF24")).toBe(CHIP_TEXT_COLOURS.dark);
    expect(readableTextOn("#FFFFFF")).toBe(CHIP_TEXT_COLOURS.dark);
  });

  it("puts light text on a dark shape", () => {
    expect(readableTextOn("#4C8DFF")).toBe(CHIP_TEXT_COLOURS.light);
    expect(readableTextOn("#000000")).toBe(CHIP_TEXT_COLOURS.light);
  });

  it("falls back to light text when the background is unknown", () => {
    // A CSS variable tells us nothing, and a light shape is the unusual case —
    // so the safer of the two is chosen rather than a guess at parsing it.
    expect(readableTextOn("var(--danger)")).toBe(CHIP_TEXT_COLOURS.light);
  });
});
