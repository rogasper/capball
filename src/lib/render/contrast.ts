/**
 * Text on a coloured background, without leaving the contrast to chance.
 *
 * A label chip carries its shape's own colour, and the palette has light
 * yellows as well as deep blues — so white-on-yellow (or dark-on-navy) is a real
 * possibility, and NFR-34 forbids a cue that only works by luck. The chip's text
 * colour is therefore *derived* from the background rather than fixed.
 *
 * The measure is the WCAG relative luminance, which is the standard one and is
 * cheap: the channel weights encode how much each colour contributes to
 * perceived brightness, so a mid-tone yellow and a mid-tone blue do not come out
 * "equally light".
 */

const DARK_TEXT = "#0B1220";
const LIGHT_TEXT = "#FFFFFF";

/** Above this luminance, dark text reads better; below it, light text does. */
const LUMINANCE_THRESHOLD = 0.55;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Parses `#rgb` / `#rrggbb`; anything else (a `var()`, an `rgb()`) is unknown. */
function parseHex(colour: string): [number, number, number] | null {
  const value = colour.trim();
  if (!value.startsWith("#")) return null;

  const hex = value.slice(1);
  if (hex.length === 3) {
    const [r, g, b] = hex.split("");
    if (r === undefined || g === undefined || b === undefined) return null;
    return [
      Number.parseInt(`${r}${r}`, 16),
      Number.parseInt(`${g}${g}`, 16),
      Number.parseInt(`${b}${b}`, 16),
    ];
  }
  if (hex.length === 6) {
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    return [r, g, b].every(Number.isFinite) ? [r, g, b] : null;
  }
  return null;
}

export function relativeLuminance(colour: string): number | null {
  const rgb = parseHex(colour);
  if (!rgb) return null;
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/**
 * The text colour to use on a background.
 *
 * An unreadable background — a CSS variable, a gradient, anything not a literal
 * hex — falls back to **white on a darker chip**: the renderer draws the chip in
 * the shape's colour, and white is the safer of the two when the luminance is
 * unknown, because a light shape is the unusual case.
 */
export function readableTextOn(background: string): string {
  const luminance = relativeLuminance(background);
  if (luminance === null) return LIGHT_TEXT;
  return luminance > LUMINANCE_THRESHOLD ? DARK_TEXT : LIGHT_TEXT;
}

export const CHIP_TEXT_COLOURS = { dark: DARK_TEXT, light: LIGHT_TEXT } as const;
