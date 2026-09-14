import { describe, expect, it } from "vitest";
import { pitchOutline } from "@/lib/pitch/pitchModel";
import type { Canvas2D } from "@/lib/render/canvas";
import {
  INSET_PANEL,
  insetBoxFor,
  insetFor,
  insetLayout,
  paintPitchInset,
} from "@/lib/render/pitchInset";

/**
 * The pitch inset in an exported clip (FR-40.2).
 *
 * The compositing reuses R1's overlay pipeline, so what is worth testing here is
 * the part that has no precedent: the metres-to-inset-pixels mapping (a stretched
 * pitch still looks like a pitch to most eyes), and the fact that the diagram
 * comes from the *same* model the two on-screen surfaces read.
 */

type Op = [string, ...unknown[]];

function recorder(): { ctx: Canvas2D; ops: Op[] } {
  const ops: Op[] = [];
  const ctx: Canvas2D = {
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    font: "",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    save: () => ops.push(["save"]),
    restore: () => ops.push(["restore"]),
    translate: () => ops.push(["translate"]),
    rotate: () => ops.push(["rotate"]),
    beginPath: () => ops.push(["beginPath"]),
    moveTo: (x, y) => ops.push(["moveTo", x, y]),
    lineTo: (x, y) => ops.push(["lineTo", x, y]),
    quadraticCurveTo: () => ops.push(["quadraticCurveTo"]),
    closePath: () => ops.push(["closePath"]),
    fill: () => ops.push(["fill", ctx.fillStyle]),
    stroke: () => ops.push(["stroke", ctx.strokeStyle]),
    clip: () => ops.push(["clip"]),
    setLineDash: () => ops.push(["setLineDash"]),
    measureText: (text) => ({ width: text.length * 6 }),
    fillRect: (x, y, w, h) => ops.push(["fillRect", x, y, w, h, ctx.fillStyle]),
    strokeRect: (x, y, w, h) => ops.push(["strokeRect", x, y, w, h]),
    ellipse: (cx, cy, rx, ry) => ops.push(["ellipse", cx, cy, rx, ry, ctx.fillStyle]),
    fillText: (text, x, y) => ops.push(["fillText", text, x, y]),
  };
  return { ctx, ops };
}

const PITCH_SIZE = { lengthM: 105, widthM: 68 };
const BOX = { x: 40, y: 500, w: 420, h: 320 };
const opsNamed = (ops: Op[], name: string) => ops.filter(([op]) => op === name);

describe("metres to inset pixels", () => {
  it("keeps the pitch's aspect rather than filling the box", () => {
    const layout = insetLayout(BOX, PITCH_SIZE);
    // A 105×68 pitch is wider than tall: 1.5, whatever the box does.
    expect(layout.pitch.w / layout.pitch.h).toBeCloseTo(105 / 68, 6);
    expect(layout.pitch.w).toBeLessThanOrEqual(BOX.w);
    expect(layout.pitch.h).toBeLessThanOrEqual(BOX.h);
  });

  it("puts the centre spot at the centre of the pitch rectangle", () => {
    const layout = insetLayout(BOX, PITCH_SIZE);
    const [cx, cy] = layout.toPx(0, 0);
    expect(cx).toBeCloseTo(layout.pitch.x + layout.pitch.w / 2, 6);
    expect(cy).toBeCloseTo(layout.pitch.y + layout.pitch.h / 2, 6);
  });

  it("puts the four corners where the pitch rectangle says", () => {
    const layout = insetLayout(BOX, PITCH_SIZE);
    const [left, top] = layout.toPx(-52.5, -34);
    const [right, bottom] = layout.toPx(52.5, 34);
    expect(left).toBeCloseTo(layout.pitch.x, 6);
    expect(top).toBeCloseTo(layout.pitch.y, 6);
    expect(right).toBeCloseTo(layout.pitch.x + layout.pitch.w, 6);
    expect(bottom).toBeCloseTo(layout.pitch.y + layout.pitch.h, 6);
  });
});

describe("where the inset sits", () => {
  it("scales with the frame, so 720p and 1080p look the same", () => {
    const small = insetBoxFor({ width: 1280, height: 720 }, PITCH_SIZE);
    const large = insetBoxFor({ width: 1920, height: 1080 }, PITCH_SIZE);
    expect(large.w / small.w).toBeCloseTo(1920 / 1280, 2);
  });

  it("leaves a margin from the corner and never leaves the frame", () => {
    const box = insetBoxFor({ width: 1920, height: 1080 }, PITCH_SIZE);
    expect(box.x).toBeGreaterThan(0);
    expect(box.y).toBeGreaterThan(0);
    expect(box.y + box.h).toBeLessThan(1080);
    expect(box.x + box.w).toBeLessThan(1920);
  });

  it("is offered only for a moment that has positions", () => {
    const frame = { width: 1920, height: 1080 };
    expect(insetFor({ positions: [], frame, size: PITCH_SIZE, caption: "x" })).toBeNull();
    expect(
      insetFor({
        positions: [{ xM: 0, yM: 0, teamName: "MU", teamColour: "#DA291C" }],
        frame,
        size: PITCH_SIZE,
        caption: "x",
      }),
    ).not.toBeNull();
  });
});

describe("painting the inset", () => {
  const paint = (positions: Parameters<typeof paintPitchInset>[1]["positions"]) => {
    const { ctx, ops } = recorder();
    paintPitchInset(ctx, {
      box: BOX,
      size: PITCH_SIZE,
      positions,
      caption: "Build Up · 01:41.776",
    });
    return ops;
  };

  it("draws the pitch from the same model the pitch views read", () => {
    const ops = paint([]);
    // One stroked path for the whole diagram, with a segment per model line.
    const lines = pitchOutline(PITCH_SIZE).reduce(
      (total, line) => total + line.points.length - 1,
      0,
    );
    expect(opsNamed(ops, "stroke")).toHaveLength(1);
    expect(opsNamed(ops, "lineTo")).toHaveLength(lines);
  });

  it("backs the diagram with its own panel, not with the video behind it", () => {
    const panel = opsNamed(paint([]), "fillRect")[0];
    expect(panel?.[5]).toBe(INSET_PANEL);
    expect([panel?.[1], panel?.[2], panel?.[3], panel?.[4]]).toEqual([BOX.x, BOX.y, BOX.w, BOX.h]);
  });

  it("draws one marker per position, in the team's own colour", () => {
    const ops = paint([
      { xM: -20, yM: 0, teamName: "MU", teamColour: "#DA291C" },
      { xM: 20, yM: 5, teamName: "SAB", teamColour: "#FFD700" },
    ]);
    const ellipses = opsNamed(ops, "ellipse");
    // A disc for the first team and a square for the second: shape carries the
    // team as well as colour, which a four-pixel dot cannot do with a number.
    expect(ellipses).toHaveLength(2); // the marker, and its legend swatch
    expect(opsNamed(ops, "fill").some((op) => op[1] === "#DA291C")).toBe(true);
    expect(opsNamed(ops, "fillRect").some((op) => op[5] === "#FFD700")).toBe(true);
  });

  it("states the moment, and names every team it drew", () => {
    const ops = paint([
      { xM: -20, yM: 0, teamName: "MU", teamColour: "#DA291C" },
      { xM: 20, yM: 5, teamName: "SAB", teamColour: "#FFD700" },
    ]);
    const texts = opsNamed(ops, "fillText").map((op) => String(op[1]));
    expect(texts).toContain("Build Up · 01:41.776");
    expect(texts).toContain("MU");
    expect(texts).toContain("SAB");
  });

  it("draws nothing at all for an empty box rather than throwing", () => {
    const { ctx, ops } = recorder();
    paintPitchInset(ctx, {
      box: { x: 0, y: 0, w: 0, h: 0 },
      size: PITCH_SIZE,
      positions: [],
      caption: "",
    });
    expect(ops).toHaveLength(0);
  });
});
