import type { ShapeKind, StrokePattern } from "./types";

/**
 * The notation, as data (FR-20.14).
 *
 * In football analysis the **stroke is the vocabulary**: whoever reads the
 * drawing is meant to tell a played ball from a run from a carry without a
 * caption. R1 gave every stroke one appearance, so all of that had to be written
 * out in words instead — which is what the owner meant by asking for drawing
 * that is *"lebih informatif dan bervariasi"*.
 *
 * A preset is deliberately **not** a new kind of object: it is a named set of
 * values that already exist on a style, plus the tool it is meant to be drawn
 * with. That is why choosing one changes nothing about how a shape is stored,
 * hit-tested, projected or transferred, and why an existing drawing keeps
 * working whatever happens to this list.
 */
export type StrokePreset = {
  key: string;
  /** The name an analyst would use, and the label on the button. */
  label: string;
  /** What it means, shown as the button's tooltip. */
  meaning: string;
  tool: Extract<ShapeKind, "arrow" | "line">;
  colour: string;
  pattern: StrokePattern;
  /** Fraction of the frame's width, like every stroke width (D17). */
  width: number;
};

/**
 * Five strokes that cover what a match analysis actually needs to say.
 *
 * The colours are the app's own mid-tone palette rather than pure hues, so they
 * stay legible over grass — and none of the five differs from another by colour
 * alone: the pattern carries the meaning, which is the rule NFR-24 sets for
 * fills and this applies to lines.
 */
export const STROKE_PRESETS: StrokePreset[] = [
  {
    key: "pass",
    label: "Pass",
    meaning: "The ball was played — solid line with a head",
    tool: "arrow",
    colour: "#4C8DFF",
    pattern: "solid",
    width: 0.0028,
  },
  {
    key: "run",
    label: "Run",
    meaning: "A player's movement without the ball — dashed, with a head",
    tool: "arrow",
    colour: "#F0913A",
    pattern: "dashed",
    width: 0.0025,
  },
  {
    key: "dribble",
    label: "Dribble",
    meaning: "A player carried the ball — dotted, with a head",
    tool: "arrow",
    colour: "#A78BFA",
    pattern: "dotted",
    width: 0.0028,
  },
  {
    key: "press",
    label: "Press",
    meaning: "Pressure on the ball — dash-dot, with a head",
    tool: "arrow",
    colour: "#F26D6D",
    pattern: "dashDot",
    width: 0.0025,
  },
  {
    key: "cover",
    label: "Cover",
    meaning: "Space covered rather than a movement — dashed, no head",
    tool: "line",
    colour: "#94A3B8",
    pattern: "dashed",
    width: 0.0025,
  },
];

export function presetByKey(key: string): StrokePreset | undefined {
  return STROKE_PRESETS.find((preset) => preset.key === key);
}

/**
 * The style fields a preset sets.
 *
 * Only stroke-related fields: a preset says how a *line* is drawn, so it never
 * touches a fill — restyling a zone with the Pass preset must not silently turn
 * its hatch into a solid block.
 */
export function stylePatchOf(preset: StrokePreset): {
  stroke: string;
  strokePattern: StrokePattern;
  width: number;
} {
  return { stroke: preset.colour, strokePattern: preset.pattern, width: preset.width };
}
