import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  decodeSettings,
  encodeSettings,
  SETTINGS_VERSION,
} from "@/lib/settings/values";

describe("decodeSettings", () => {
  it("falls back to the defaults for an empty table", () => {
    expect(decodeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("reads what was written", () => {
    const values = {
      preRollMs: "5000",
      postRollMs: "9000",
      exportDestination: "/clips",
      exportTemplate: "{tag}_{index}",
      exportMode: "accurate",
      exportExtraBeforeMs: "2000",
      exportExtraAfterMs: "1000",
      exportConcatenate: "true",
      annotationWindowMs: "3000",
      pitchLengthM: "100",
      pitchWidthM: "64",
      annotationStyle:
        '{"stroke":"#FF4C4C","fill":"#112233","width":0.005,"fontSize":0.05,"opacity":0.8}',
    };

    expect(decodeSettings(values)).toEqual({
      preRollMs: 5_000,
      postRollMs: 9_000,
      exportDestination: "/clips",
      exportTemplate: "{tag}_{index}",
      exportMode: "accurate",
      exportExtraBeforeMs: 2_000,
      exportExtraAfterMs: 1_000,
      exportConcatenate: true,
      exportAnnotations: false,
      annotationWindowMs: 3_000,
      pitchLengthM: 100,
      pitchWidthM: 64,
      annotationStyle: {
        stroke: "#FF4C4C",
        fill: "#112233",
        width: 0.005,
        fontSize: 0.05,
        opacity: 0.8,
        // A style stored before R2 carries no pattern fields, and this is the
        // guarantee that it still renders exactly as it did (FR-20.12).
        fillPattern: "solid",
        patternScale: 0.02,
        patternAngle: -Math.PI / 4,
        // The same guarantee for the line style added in FR-20.14: absent means
        // solid, so an old drawing is not restyled by the release that adds it.
        strokePattern: "solid",
      },
    });
  });

  it("round-trips through storage", () => {
    const patch = {
      preRollMs: 3_000,
      exportDestination: "/somewhere",
      exportConcatenate: true,
      exportMode: "accurate" as const,
    };
    expect(decodeSettings(encodeSettings(patch))).toMatchObject(patch);
  });

  it("ignores nonsense rather than adopting it", () => {
    const decoded = decodeSettings({
      preRollMs: "not a number",
      postRollMs: "-5000",
      exportMode: "sideways",
      exportTemplate: "   ",
      exportExtraBeforeMs: "NaN",
    });

    expect(decoded.preRollMs).toBe(DEFAULT_SETTINGS.preRollMs);
    expect(decoded.postRollMs).toBe(DEFAULT_SETTINGS.postRollMs);
    expect(decoded.exportMode).toBe(DEFAULT_SETTINGS.exportMode);
    expect(decoded.exportTemplate).toBe(DEFAULT_SETTINGS.exportTemplate);
    expect(decoded.exportExtraBeforeMs).toBe(DEFAULT_SETTINGS.exportExtraBeforeMs);
  });

  it("treats an empty destination as none chosen", () => {
    expect(decodeSettings({ exportDestination: "" }).exportDestination).toBeNull();
  });

  it("treats anything but 'true' as false", () => {
    expect(decodeSettings({ exportConcatenate: "yes" }).exportConcatenate).toBe(false);
    expect(decodeSettings({ exportConcatenate: "1" }).exportConcatenate).toBe(false);
  });
});

describe("encodeSettings", () => {
  it("stores primitives as text", () => {
    expect(encodeSettings({ preRollMs: 4_000, exportConcatenate: true })).toEqual({
      preRollMs: "4000",
      exportConcatenate: "true",
    });
  });

  it("stores an empty string for a cleared path", () => {
    expect(encodeSettings({ exportDestination: null })).toEqual({ exportDestination: "" });
  });

  it("skips what was not changed", () => {
    expect(encodeSettings({ preRollMs: 1_000 })).not.toHaveProperty("postRollMs");
  });
});

describe("version", () => {
  it("is declared, so a future format change has somewhere to live", () => {
    expect(SETTINGS_VERSION).toBeGreaterThanOrEqual(1);
  });
});
