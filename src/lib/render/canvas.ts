import type { Point } from "@/lib/annotate/geometry";
import type { Primitive } from "@/lib/annotate/primitives";
import type { StrokePattern } from "@/lib/annotate/types";
import { readableTextOn } from "./contrast";
import { type Bounds, patternSegments } from "./pattern";
import { strokeDash } from "./stroke";

/**
 * The only code that turns primitives into pixels (D18).
 *
 * The app and the annotation burn-in both call `renderPrimitives`: the preview
 * passes a canvas sized to the picture on screen, the export passes one sized to
 * the output video. That is the whole reason NFR-27 needs no parity test.
 *
 * The context is typed structurally rather than as `CanvasRenderingContext2D`
 * so the drawing can be recorded and asserted in a test without a rasteriser.
 */
export type Canvas2D = {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  closePath(): void;
  fill(): void;
  stroke(): void;
  clip(): void;
  /** The line's pattern (FR-20.14); an empty array is a solid line. */
  setLineDash(segments: number[]): void;
  /** Needed to size a label's background rather than guessing its width. */
  measureText(text: string): { width: number };
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    rotation: number,
    start: number,
    end: number,
  ): void;
  fillText(text: string, x: number, y: number): void;
  globalAlpha: number;
  strokeStyle: string;
  fillStyle: string;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  font: string;
  textBaseline: string;
};

/** Stroke widths are fractions of the frame width, but never sub-pixel. */
function strokeWidthPx(width: number, frameWidth: number): number {
  return Math.max(1, width * frameWidth);
}

function scalePoints(points: Point[], width: number, height: number): Point[] {
  return points.map(([x, y]) => [x * width, y * height] as Point);
}

function drawArrowHead(
  ctx: Canvas2D,
  from: Point,
  to: Point,
  lineWidth: number,
  colour: string,
): void {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const size = Math.max(lineWidth * 3.5, 6);
  const spread = Math.PI / 7;

  ctx.beginPath();
  ctx.moveTo(to[0], to[1]);
  ctx.lineTo(to[0] - size * Math.cos(angle - spread), to[1] - size * Math.sin(angle - spread));
  ctx.lineTo(to[0] - size * Math.cos(angle + spread), to[1] - size * Math.sin(angle + spread));
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
}

/**
 * Strokes a path in the primitive's own line style (FR-20.14).
 *
 * One place sets and clears the dash, so no later stroke can inherit it: the
 * dash is a property of this shape, not of the canvas. The array comes from
 * `strokeDash`, which measures in stroke widths, so the preview and the export
 * agree at their own resolutions.
 */
function strokeWithDash(
  ctx: Canvas2D,
  pattern: StrokePattern,
  lineWidth: number,
  colour: string,
): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash(strokeDash(pattern, lineWidth));
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * Where a label's chip is anchored.
 *
 * A closed shape is labelled at the top-left of its bounds — outside the shape,
 * where it covers nothing. A stroke is labelled at the **middle of its top
 * edge**, because a line's bounds are as wide as the line and its corner is at
 * one end, which would put the words over the wrong part of the movement.
 */
function labelAnchor(primitive: Primitive, bounds: Bounds | null): [number, number] {
  if (!bounds) return [0, 0];
  const open = primitive.kind === "path" && !primitive.closed;
  return open ? [bounds.x + bounds.w / 2, bounds.y] : [bounds.x, bounds.y];
}

/** The longest label drawn on the frame; the panel always has the full text. */
const MAX_LABEL_CHARS = 40;

/**
 * Draws a shape's label as a chip above it (FR-20.15).
 *
 * The defect this fixes: `label` has been stored since R1 while only a **text**
 * shape ever drew its words, so a zone could be named and show nothing. The chip
 * carries its own background, because a label over moving footage cannot rely on
 * the picture behind it, and its text colour is derived from that background so
 * a light shape cannot get white text (NFR-34).
 *
 * It sits outside the shape's own bounds rather than on top of them, and is
 * clamped into the picture: a label at the edge is moved, not cut off.
 */
function paintLabel(
  ctx: Canvas2D,
  text: string | null,
  bounds: Bounds | null,
  anchor: Point,
  fontSize: number,
  height: number,
  width: number,
  colour: string,
): void {
  const label = text?.trim();
  if (!label || !bounds) return;

  const size = Math.max(1, fontSize * height);
  const shown = label.length > MAX_LABEL_CHARS ? `${label.slice(0, MAX_LABEL_CHARS - 1)}…` : label;
  const pad = Math.max(2, size * 0.35);
  const textWidth = ctx.measureText(shown).width;
  const chipW = textWidth + pad * 2;
  const chipH = size + pad * 2;

  // Above the shape, with its bottom-left at the anchor. A stroke that is wider
  // than it is tall (a line, an arrow) is labelled at its middle instead, where
  // there is room for the chip to be read.
  let x = anchor[0];
  let y = anchor[1] - chipH - pad * 0.5;
  if (y < 0) y = bounds.y + bounds.h + pad * 0.5;

  ctx.font = `${size}px Inter, system-ui, sans-serif`;
  ctx.textBaseline = "top";
  x = Math.min(Math.max(0, x), Math.max(0, width - chipW));
  y = Math.min(Math.max(0, y), Math.max(0, height - chipH));

  const background = colour;
  ctx.fillStyle = background;
  ctx.fillRect(x, y, chipW, chipH);
  ctx.fillStyle = readableTextOn(background);
  ctx.fillText(shown, x + pad, y + pad);
}

/** The shape's own bounds in pixels, which is what a hatch has to cover. */
function pixelBounds(primitive: Primitive, width: number, height: number): Bounds | null {
  if (primitive.kind === "rect" || primitive.kind === "ellipse") {
    return {
      x: primitive.x * width,
      y: primitive.y * height,
      w: primitive.w * width,
      h: primitive.h * height,
    };
  }
  if (primitive.kind === "path") {
    if (primitive.points.length < 3) return null;
    const points = scalePoints(primitive.points, width, height);
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
  }
  return null;
}

/**
 * Paints a hatch or cross-hatch fill (FR-20.12).
 *
 * The pattern is clipped to the shape's own path, so one generator serves a
 * rectangle, an ellipse and a polygon without knowing which it is drawing. The
 * lines are built into a **single** path and stroked once: a hatched zone at the
 * smallest allowed spacing is hundreds of segments, and one stroke is what keeps
 * that inside the repaint budget (T11).
 *
 * The bounds and the angle are in the shape's local space, so the pattern turns
 * with a rotated shape rather than staying fixed to the screen — the same choice
 * D17 makes for geometry, and the one that keeps the app and the export equal.
 */
function paintPatternFill(
  ctx: Canvas2D,
  primitive: Primitive,
  width: number,
  height: number,
  trace: () => void,
): void {
  if (!primitive.fill || primitive.fillPattern === "solid") return;
  const bounds = pixelBounds(primitive, width, height);
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) return;

  ctx.save();
  ctx.beginPath();
  trace();
  ctx.clip();

  ctx.beginPath();
  const segments = patternSegments(
    bounds,
    primitive.patternScale * width,
    primitive.patternAngle,
    primitive.fillPattern,
  );
  for (const [from, to] of segments) {
    ctx.moveTo(from[0], from[1]);
    ctx.lineTo(to[0], to[1]);
  }
  ctx.strokeStyle = primitive.fill;
  // Slightly lighter than the outline, so a hatched zone reads as a fill rather
  // than competing with the edge that defines it.
  ctx.lineWidth = Math.max(1, strokeWidthPx(primitive.width, width) * 0.75);
  ctx.stroke();
  ctx.restore();
}

/**
 * Draws primitives into a context of the given pixel size.
 *
 * The width and height are the picture's, not the element's: the caller is
 * responsible for the letterbox (see `contentRect`).
 */
export function renderPrimitives(
  primitives: Primitive[],
  ctx: Canvas2D,
  width: number,
  height: number,
): void {
  if (width <= 0 || height <= 0) return;

  for (const primitive of primitives) {
    ctx.save();
    ctx.globalAlpha = primitive.opacity;

    if (primitive.rotation !== 0) {
      const cx = primitive.center[0] * width;
      const cy = primitive.center[1] * height;
      ctx.translate(cx, cy);
      ctx.rotate(primitive.rotation);
      ctx.translate(-cx, -cy);
    }

    const lineWidth = strokeWidthPx(primitive.width, width);

    switch (primitive.kind) {
      case "rect": {
        const x = primitive.x * width;
        const y = primitive.y * height;
        const w = primitive.w * width;
        const h = primitive.h * height;
        if (primitive.fill && primitive.fillPattern === "solid") {
          ctx.fillStyle = primitive.fill;
          ctx.fillRect(x, y, w, h);
        } else {
          paintPatternFill(ctx, primitive, width, height, () => {
            ctx.moveTo(x, y);
            ctx.lineTo(x + w, y);
            ctx.lineTo(x + w, y + h);
            ctx.lineTo(x, y + h);
            ctx.closePath();
          });
        }
        if (primitive.stroke) {
          ctx.setLineDash(strokeDash(primitive.strokePattern, lineWidth));
          ctx.strokeStyle = primitive.stroke;
          ctx.lineWidth = lineWidth;
          ctx.strokeRect(x, y, w, h);
          ctx.setLineDash([]);
        }
        break;
      }

      case "ellipse": {
        const cx = (primitive.x + primitive.w / 2) * width;
        const cy = (primitive.y + primitive.h / 2) * height;
        const rx = Math.abs(primitive.w / 2) * width;
        const ry = Math.abs(primitive.h / 2) * height;
        const trace = () => {
          ctx.moveTo(cx + rx, cy);
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        };
        if (primitive.fill && primitive.fillPattern === "solid") {
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.fillStyle = primitive.fill;
          ctx.fill();
        } else {
          paintPatternFill(ctx, primitive, width, height, trace);
        }
        if (primitive.stroke) {
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          strokeWithDash(ctx, primitive.strokePattern, lineWidth, primitive.stroke);
        }
        break;
      }

      case "text": {
        const size = Math.max(1, primitive.fontSize * height);
        ctx.fillStyle = primitive.stroke ?? "#FFFFFF";
        ctx.font = `${size}px Inter, system-ui, sans-serif`;
        ctx.textBaseline = "top";
        ctx.fillText(primitive.text, primitive.x * width, primitive.y * height);
        break;
      }

      case "path": {
        const points = scalePoints(primitive.points, width, height);
        if (points.length < 2) break;

        const trace = () => {
          ctx.moveTo(points[0][0], points[0][1]);
          if (primitive.smooth && points.length > 2) {
            // Curves through the midpoints, so a simplified stroke still reads as
            // a drawn line rather than a chain of segments.
            for (let i = 0; i < points.length - 1; i++) {
              const mx = (points[i][0] + points[i + 1][0]) / 2;
              const my = (points[i][1] + points[i + 1][1]) / 2;
              ctx.quadraticCurveTo(points[i][0], points[i][1], mx, my);
            }
            const last = points[points.length - 1];
            ctx.lineTo(last[0], last[1]);
          } else {
            for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
          }
          if (primitive.closed) ctx.closePath();
        };

        if (primitive.closed && primitive.fill && primitive.fillPattern !== "solid") {
          paintPatternFill(ctx, primitive, width, height, trace);
        }

        ctx.beginPath();
        trace();
        if (primitive.closed && primitive.fill && primitive.fillPattern === "solid") {
          ctx.fillStyle = primitive.fill;
          ctx.fill();
        }
        if (primitive.stroke) {
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          strokeWithDash(ctx, primitive.strokePattern, lineWidth, primitive.stroke);
        }
        if (primitive.head) {
          drawArrowHead(
            ctx,
            points[points.length - 2],
            points[points.length - 1],
            lineWidth,
            primitive.stroke ?? "#FFFFFF",
          );
        }
        break;
      }
    }

    // The label last, so it reads over its own shape rather than under it
    // (FR-20.15). A text shape is skipped: it has already drawn its words.
    if (primitive.kind !== "text") {
      const bounds = pixelBounds(primitive, width, height);
      paintLabel(
        ctx,
        primitive.label,
        bounds,
        labelAnchor(primitive, bounds),
        primitive.fontSize,
        height,
        width,
        primitive.stroke ?? "#FFFFFF",
      );
    }

    ctx.restore();
  }
}
