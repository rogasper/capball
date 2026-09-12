import { describe, expect, it } from "vitest";
import { boxGeometry, pathGeometry, twoPointGeometry } from "@/lib/annotate/geometry";
import { toPrimitive } from "@/lib/annotate/primitives";
import { type Annotation, DEFAULT_STYLE, type ShapeKind } from "@/lib/annotate/types";
import { type Canvas2D, renderPrimitives } from "@/lib/render/canvas";

/**
 * A recording context.
 *
 * The renderer is deliberately typed structurally, so the drawing can be
 * asserted exactly without a rasteriser — which is the only way to test it in
 * jsdom, and more precise than a pixel diff anyway.
 */
type Op = [string, ...unknown[]];

function recorder(): { ctx: Canvas2D; ops: Op[] } {
  const ops: Op[] = [];
  let alpha = 1;

  const base: Omit<Canvas2D, "globalAlpha"> = {
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    font: "",
    textBaseline: "alphabetic",
    save: () => ops.push(["save"]),
    restore: () => ops.push(["restore"]),
    translate: (x, y) => ops.push(["translate", x, y]),
    rotate: (angle) => ops.push(["rotate", angle]),
    beginPath: () => ops.push(["beginPath"]),
    moveTo: (x, y) => ops.push(["moveTo", x, y]),
    lineTo: (x, y) => ops.push(["lineTo", x, y]),
    quadraticCurveTo: (cx, cy, x, y) => ops.push(["quadraticCurveTo", cx, cy, x, y]),
    closePath: () => ops.push(["closePath"]),
    fill: () => ops.push(["fill", ctx.fillStyle]),
    stroke: () => ops.push(["stroke"]),
    fillRect: (x, y, w, h) => ops.push(["fillRect", x, y, w, h]),
    strokeRect: (x, y, w, h) => ops.push(["strokeRect", x, y, w, h]),
    ellipse: (cx, cy, rx, ry, rotation, start, end) =>
      ops.push(["ellipse", cx, cy, rx, ry, rotation, start, end]),
    fillText: (text, x, y) => ops.push(["fillText", text, x, y]),
  };

  const ctx = base as Canvas2D;
  // Every opacity the renderer applies is recorded as it is set.
  Object.defineProperty(ctx, "globalAlpha", {
    get: () => alpha,
    set: (value: number) => {
      alpha = value;
      ops.push(["alpha", value]);
    },
  });

  return { ctx, ops };
}

function annotation(kind: ShapeKind, patch: Partial<Annotation> = {}): Annotation {
  return {
    id: 1,
    uid: "u1",
    eventId: 1,
    kind,
    windowMode: "moment",
    windowMs: 2_500,
    geometry: boxGeometry([0.1, 0.1], [0.3, 0.3]),
    style: { ...DEFAULT_STYLE },
    label: null,
    z: 0,
    ...patch,
  };
}

function draw(annotation: Annotation, width = 1000, height = 1000): Op[] {
  const { ctx, ops } = recorder();
  renderPrimitives([toPrimitive(annotation)], ctx, width, height);
  return ops;
}

function opsNamed(ops: Op[], name: string): Op[] {
  return ops.filter((op) => op[0] === name);
}

describe("renderPrimitives", () => {
  it("fills and strokes a rectangle at the frame's scale", () => {
    const ops = draw(
      annotation("rect", { style: { ...DEFAULT_STYLE, fill: "#AABBCC", width: 0.01 } }),
    );

    const [, fx, fy, fw, fh] = opsNamed(ops, "fillRect")[0];
    expect([fx, fy]).toEqual([100, 100]);
    expect(fw).toBeCloseTo(200);
    expect(fh).toBeCloseTo(200);
    expect(opsNamed(ops, "strokeRect")).toHaveLength(1);
  });

  it("draws an ellipse from its box", () => {
    const ops = draw(annotation("ellipse"));
    const [, cx, cy, rx, ry, rotation, start, end] = opsNamed(ops, "ellipse")[0];
    expect(cx).toBeCloseTo(200);
    expect(cy).toBeCloseTo(200);
    expect(rx).toBeCloseTo(100);
    expect(ry).toBeCloseTo(100);
    expect(rotation).toBe(0);
    expect(start).toBe(0);
    expect(end).toBeCloseTo(Math.PI * 2);
  });

  it("sets a font sized from the frame's height", () => {
    const { ctx, ops } = recorder();
    renderPrimitives([toPrimitive(annotation("text", { label: "Zone 14" }))], ctx, 1000, 1000);

    expect(opsNamed(ops, "fillText")[0]).toEqual(["fillText", "Zone 14", 100, 100]);
    // 0.045 of a 1000 px frame is 45 px.
    expect(ctx.font).toContain("45px");
    expect(ctx.textBaseline).toBe("top");
  });

  it("draws a two-point line as a segment", () => {
    const ops = draw(annotation("line", { geometry: twoPointGeometry([0.2, 0.2], [0.8, 0.6]) }));
    expect(opsNamed(ops, "lineTo")).toEqual([["lineTo", 800, 600]]);
    expect(opsNamed(ops, "quadraticCurveTo")).toHaveLength(0);
    expect(opsNamed(ops, "closePath")).toHaveLength(0);
  });

  it("draws a freehand stroke as curves through its points", () => {
    const ops = draw(
      annotation("freehand", {
        geometry: pathGeometry([
          [0.2, 0.2],
          [0.4, 0.5],
          [0.6, 0.3],
        ]),
      }),
    );
    expect(opsNamed(ops, "quadraticCurveTo").length).toBeGreaterThan(0);
  });

  it("closes and fills a zone but not an open stroke", () => {
    const zone = draw(
      annotation("polygon", {
        geometry: pathGeometry([
          [0.2, 0.2],
          [0.6, 0.2],
          [0.6, 0.6],
        ]),
        style: { ...DEFAULT_STYLE, fill: "#112233" },
      }),
    );
    const stroke = draw(
      annotation("freehand", {
        geometry: pathGeometry([
          [0.2, 0.2],
          [0.4, 0.4],
        ]),
      }),
    );

    expect(opsNamed(zone, "closePath")).toHaveLength(1);
    expect(opsNamed(zone, "fill")).toHaveLength(1);
    expect(opsNamed(stroke, "fill")).toHaveLength(0);
  });

  it("fills an arrowhead in the stroke's colour", () => {
    const ops = draw(
      annotation("arrow", {
        geometry: twoPointGeometry([0.2, 0.2], [0.8, 0.8]),
        style: { ...DEFAULT_STYLE, stroke: "#FF0000" },
      }),
    );

    const fill = opsNamed(ops, "fill");
    expect(fill).toHaveLength(1);
    expect(fill[0][1]).toBe("#FF0000");
  });

  it("rotates about the box centre", () => {
    const ops = draw(
      annotation("rect", {
        geometry: { ...boxGeometry([0.1, 0.1], [0.3, 0.3]), rotation: Math.PI / 2 },
      }),
    );

    expect(opsNamed(ops, "translate")).toEqual([
      ["translate", 200, 200],
      ["translate", -200, -200],
    ]);
    expect(opsNamed(ops, "rotate")[0][1]).toBeCloseTo(Math.PI / 2);
  });

  it("applies opacity and balances save and restore", () => {
    const { ctx, ops } = recorder();
    renderPrimitives(
      [
        toPrimitive(annotation("rect", { style: { ...DEFAULT_STYLE, opacity: 0.4 } })),
        toPrimitive(annotation("ellipse", { id: 2 })),
      ],
      ctx,
      1000,
      1000,
    );

    const saves = opsNamed(ops, "save");
    expect(saves).toHaveLength(2);
    expect(opsNamed(ops, "restore")).toHaveLength(2);
    expect(opsNamed(ops, "alpha")).toEqual([
      ["alpha", 0.4],
      ["alpha", 1],
    ]);
  });

  it("never draws a sub-pixel hairline", () => {
    const { ctx, ops } = recorder();
    renderPrimitives(
      [toPrimitive(annotation("rect", { style: { ...DEFAULT_STYLE, width: 0.000001 } }))],
      ctx,
      100,
      100,
    );
    // The context records the line width it was given for the stroke.
    const stroke = ops.findIndex((op) => op[0] === "strokeRect");
    expect(stroke).toBeGreaterThan(-1);
    expect(ctx.lineWidth).toBeGreaterThanOrEqual(1);
  });

  it("draws nothing into a collapsed canvas", () => {
    const { ctx, ops } = recorder();
    renderPrimitives([toPrimitive(annotation("rect"))], ctx, 0, 0);
    expect(ops).toHaveLength(0);
  });
});
