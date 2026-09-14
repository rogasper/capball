import type { StrokePattern } from "@/lib/annotate/types";

/**
 * Line styles, as dash arrays measured in **stroke widths** (D43, FR-20.14).
 *
 * Two decisions are folded into three lines of arithmetic:
 *
 * 1. **Fractions of the stroke width, never pixels.** A stroke's width is already
 *    a fraction of the picture (D17), so a dash expressed in widths survives the
 *    export exactly as the weight does: the app draws a 2 px line with 8 px
 *    dashes, the 1080p burn-in draws a 4 px line with 16 px dashes, and the two
 *    look identical. In pixels they would not.
 * 2. **Every pattern is designed to read at a glance over moving footage**, which
 *    is why `dotted` is a round-ish 0/2W rather than a fine 1–2 px dot that a
 *    video codec would blur away.
 *
 * The numbers are multiples of the width: `[on, off, ...]`. An empty array means
 * a solid line, which is what `setLineDash([])` wants, so the renderer can pass
 * the result straight through with no branch of its own.
 */
const DASH_UNITS: Record<StrokePattern, number[]> = {
  solid: [],
  // Long enough to read as "not the ball was played": a run, a movement.
  dashed: [4, 3],
  // Dots are on/off at roughly one width, the shortest a codec tolerates.
  dotted: [1, 2],
  // Pressure and cover: a dash with a pip, distinct from a dash at a glance.
  dashDot: [5, 2, 1, 2],
};

/** How much of a solid line's appearance a dash pattern keeps. */
export function dashUnits(pattern: StrokePattern): number[] {
  return DASH_UNITS[pattern] ?? [];
}

/**
 * The dash array for a pattern at a given stroke width, in pixels.
 *
 * `widthPx` is the *rendered* stroke width, already scaled to whichever surface
 * is being drawn — the preview's canvas or the export's. A dotted pattern at a
 * 1 px minimum width still gets whole-pixel dashes, so a very thin line cannot
 * turn into a smear of grey.
 */
export function strokeDash(pattern: StrokePattern, widthPx: number): number[] {
  const units = dashUnits(pattern);
  if (units.length === 0) return [];
  const unit = Math.max(1, widthPx);
  return units.map((value) => Math.round(value * unit));
}

/** A label for the toolbar and for a screen reader; never only a picture. */
export const STROKE_PATTERN_LABELS: Record<StrokePattern, string> = {
  solid: "Solid",
  dashed: "Dashed",
  dotted: "Dotted",
  dashDot: "Dash-dot",
};

/**
 * A dash pattern drawn as an SVG path, so a toolbar button can *show* the line
 * instead of naming it.
 */
export function strokePreviewPath(
  pattern: StrokePattern,
  strokeWidth = 2,
): { d: string; dash: string | null; strokeWidth: number } {
  const y = 6;
  // The same relationship the renderer uses — dash lengths as multiples of the
  // stroke's width — so a toolbar preview cannot show a rhythm the canvas will
  // not draw.
  const dash = strokeDash(pattern, strokeWidth);
  return {
    d: `M1 ${y} H 23`,
    dash: dash.length === 0 ? null : dash.join(" "),
    strokeWidth,
  };
}
