import { type PitchSize, pitchOutline } from "@/lib/pitch/pitchModel";
import type { Canvas2D } from "./canvas";
import { readableTextOn } from "./contrast";

/**
 * The pitch as an inset inside an exported clip (FR-40.2, D46).
 *
 * Drawn by the **canvas** renderer, like everything else on the export path, so
 * the export never depends on a GPU or a WebGL context (D36 holds). It reads the
 * same `pitchOutline` the top-down view and the angled scene read, so the three
 * surfaces cannot disagree about where the penalty area is — the diagram is
 * law-fixed geometry, and this is the third consumer of it rather than a third
 * definition of it.
 *
 * The inset is **top-down**, by decision: an angled inset would need the three.js
 * scene rendered offscreen on the export path, which is the trade D36 refuses.
 * `PRD-R2.md` FR-40.2 records the narrowing.
 */

export type InsetBox = { x: number; y: number; w: number; h: number };

export type InsetPosition = {
  xM: number;
  yM: number;
  teamName: string | null;
  teamColour: string | null;
};

export type PitchInset = {
  /** Where the whole inset sits in the output, in pixels. */
  box: InsetBox;
  size: PitchSize;
  positions: InsetPosition[];
  /** What moment this shows. FR-40.2 requires the inset to state it. */
  caption: string;
};

/** Air around the touchlines, in metres, so the lines are not at the panel edge. */
export const INSET_MARGIN_M = 2.5;
/** A translucent dark panel: readable over grass, a crowd or a replay wipe. */
export const INSET_PANEL = "rgba(11, 17, 26, 0.78)";
export const INSET_LINE = "#E2E8F0";
/** The caption strip takes this share of the inset's height. */
export const INSET_CAPTION_SHARE = 0.16;
/** Colour for a position whose team has none, matching the app's neutral. */
const NEUTRAL_TEAM_COLOUR = "#64748B";

export type InsetLayout = {
  /** Pixels per metre. */
  scale: number;
  /** The pitch rectangle inside the panel, in pixels. */
  pitch: InsetBox;
  toPx: (xM: number, yM: number) => [number, number];
};

/**
 * Metres to inset pixels, preserving the pitch's aspect inside the box.
 *
 * A separate pure function because it is the part that can be wrong without
 * looking wrong: a stretched pitch still looks like a pitch to most eyes, and an
 * inset is exactly where nobody will measure it.
 */
export function insetLayout(
  pitchArea: InsetBox,
  size: PitchSize,
  marginM = INSET_MARGIN_M,
): InsetLayout {
  const spanX = Math.max(1, size.lengthM + marginM * 2);
  const spanY = Math.max(1, size.widthM + marginM * 2);
  const scale = Math.min(pitchArea.w / spanX, pitchArea.h / spanY);

  const w = size.lengthM * scale;
  const h = size.widthM * scale;
  const x = pitchArea.x + (pitchArea.w - w) / 2;
  const y = pitchArea.y + (pitchArea.h - h) / 2;

  return {
    scale,
    pitch: { x, y, w, h },
    toPx: (xM, yM) => [x + (xM + size.lengthM / 2) * scale, y + (yM + size.widthM / 2) * scale],
  };
}

/** The inset's width as a share of the frame, so it scales with the export. */
export const INSET_WIDTH_SHARE = 0.24;
/** Air between the inset and the frame's edge, as a share of the frame width. */
export const INSET_EDGE_SHARE = 0.025;

/**
 * Where the inset sits in a frame of this size: bottom-left, sized as a share of
 * the width rather than in pixels, so the same inset appears the same size in a
 * 720p clip and a 1080p one (D17's rule, applied to the inset).
 *
 * The panel is as tall as the pitch needs **plus** its caption strip, given the
 * pitch's own aspect — computing it here rather than discovering it means the
 * diagram is never squeezed to make room for the words underneath it.
 */
export function insetBoxFor(
  frame: { width: number; height: number },
  size: PitchSize,
  marginM = INSET_MARGIN_M,
): InsetBox {
  const w = Math.max(80, Math.round(frame.width * INSET_WIDTH_SHARE));
  const pitchAspect = (size.lengthM + marginM * 2) / Math.max(1, size.widthM + marginM * 2);
  const pitchH = w / pitchAspect;
  const h = Math.round(pitchH / (1 - INSET_CAPTION_SHARE));
  const edge = Math.round(frame.width * INSET_EDGE_SHARE);

  return {
    x: edge,
    y: Math.max(0, frame.height - h - edge),
    w,
    h,
  };
}

/** The inset for one clip, or null when the moment has nothing to place. */
export function insetFor(input: {
  positions: InsetPosition[];
  frame: { width: number; height: number };
  size: PitchSize;
  caption: string;
}): PitchInset | null {
  if (input.positions.length === 0) return null;
  return {
    box: insetBoxFor(input.frame, input.size),
    size: input.size,
    positions: input.positions,
    caption: input.caption,
  };
}

/**
 * One marker: a disc for the first team, a square for the second.
 *
 * Shape carries the team as well as colour, which is what NFR-34 asks for and
 * what a 4-pixel dot cannot do with a shirt number. The legend names both.
 */
function spotShape(index: number): "disc" | "square" {
  return index === 0 ? "disc" : "square";
}

function paintSpot(
  ctx: Canvas2D,
  at: [number, number],
  radius: number,
  shape: "disc" | "square",
  colour: string,
): void {
  if (shape === "disc") {
    ctx.beginPath();
    ctx.ellipse(at[0], at[1], radius, radius, 0, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();
    // A ring in the panel's own colour, so a marker stays separable from the one
    // behind it however the team colours fall.
    ctx.strokeStyle = INSET_PANEL;
    ctx.lineWidth = Math.max(1, radius * 0.4);
    ctx.stroke();
    return;
  }

  const side = radius * 2;
  ctx.fillStyle = colour;
  ctx.fillRect(at[0] - radius, at[1] - radius, side, side);
  ctx.strokeStyle = INSET_PANEL;
  ctx.lineWidth = Math.max(1, radius * 0.4);
  ctx.strokeRect(at[0] - radius, at[1] - radius, side, side);
}

/**
 * Paints the inset: the pitch, the moment's positions, and what it is showing.
 *
 * The caption strip is reserved **before** the layout, so the diagram is fitted
 * to the space that is left rather than the text being drawn over the pitch.
 */
export function paintPitchInset(ctx: Canvas2D, input: PitchInset): void {
  const { box } = input;
  if (box.w <= 0 || box.h <= 0) return;

  const captionH = Math.max(14, box.h * INSET_CAPTION_SHARE);
  const pad = Math.max(4, box.w * 0.018);

  ctx.fillStyle = INSET_PANEL;
  ctx.fillRect(box.x, box.y, box.w, box.h);

  const layout = insetLayout(
    { x: box.x + pad, y: box.y + pad, w: box.w - pad * 2, h: box.h - captionH - pad },
    input.size,
  );

  ctx.beginPath();
  for (const line of pitchOutline(input.size)) {
    const [first, ...rest] = line.points;
    if (!first) continue;
    ctx.moveTo(...layout.toPx(first[0], first[1]));
    for (const [xM, yM] of rest) ctx.lineTo(...layout.toPx(xM, yM));
  }
  ctx.strokeStyle = INSET_LINE;
  ctx.lineWidth = Math.max(1, box.w * 0.0032);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();

  // The teams, in the order they appear, so the shape a team gets is stable for
  // this clip and the legend below matches the dots above.
  const teams: { name: string; colour: string }[] = [];
  for (const position of input.positions) {
    const name = position.teamName ?? "No team";
    if (!teams.some((team) => team.name === name)) {
      teams.push({ name, colour: position.teamColour ?? NEUTRAL_TEAM_COLOUR });
    }
  }

  const radius = Math.max(2.5, box.w * 0.013);
  for (const position of input.positions) {
    const name = position.teamName ?? "No team";
    const index = Math.max(
      0,
      teams.findIndex((team) => team.name === name),
    );
    paintSpot(
      ctx,
      layout.toPx(position.xM, position.yM),
      radius,
      spotShape(index),
      position.teamColour ?? NEUTRAL_TEAM_COLOUR,
    );
  }

  const size = Math.max(9, box.w * 0.03);
  const baseline = box.y + box.h - captionH / 2;
  ctx.font = `${size}px Inter, system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = readableTextOn(INSET_PANEL);
  ctx.fillText(input.caption, box.x + pad, baseline);

  // The legend, right to left from the caption, so the moment's own timecode is
  // never the thing that gets clipped.
  let x = box.x + box.w - pad;
  for (const team of [...teams].reverse()) {
    const width = ctx.measureText(team.name).width;
    x -= width;
    ctx.fillStyle = readableTextOn(INSET_PANEL);
    ctx.fillText(team.name, x, baseline);
    x -= radius * 1.6;
    paintSpot(ctx, [x, baseline], radius * 0.6, spotShape(teams.indexOf(team)), team.colour);
    x -= radius * 1.6;
  }

  // A hairline border, so the panel reads as an object rather than as a hole in
  // the picture over a dark frame.
  ctx.strokeStyle = INSET_LINE;
  ctx.lineWidth = 1;
  ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
}
