import { sortByLayer, toPrimitive } from "@/lib/annotate/primitives";
import type { Annotation } from "@/lib/annotate/types";
import { type Canvas2D, renderPrimitives } from "./canvas";
import { type PitchInset, paintPitchInset } from "./pitchInset";

/**
 * Rasterising the drawings for an export (FR-40.1, D18).
 *
 * This is the *only* difference between the app and the burn-in: the app hands
 * `renderPrimitives` a canvas sized to the picture on screen, this hands it one
 * sized to the output video. The shapes, their geometry and their relative
 * weights are the same code, which is what makes NFR-27 structural rather than
 * something to test for.
 *
 * The result is a **transparent** PNG, so the video shows through everywhere a
 * shape is not drawn.
 */

export type BurnInFrame = {
  annotations: Annotation[];
  /** The export resolution, in pixels. */
  width: number;
  height: number;
  /**
   * The pitch as an inset (FR-40.2), drawn into the same transparent PNG as the
   * drawings. One overlay input and one `enable` expression for the whole frame,
   * which is what keeps a static inset free of any new machinery in the filter
   * graph — and what keeps the inset on the canvas renderer rather than on a GPU.
   */
  inset?: PitchInset;
};

export function renderOverlayPng(input: BurnInFrame): string {
  const width = Math.max(1, Math.round(input.width));
  const height = Math.max(1, Math.round(input.height));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("This system cannot render the drawings into an export overlay.");
  }

  ctx.clearRect(0, 0, width, height);
  renderPrimitives(
    sortByLayer(input.annotations).map(toPrimitive),
    ctx as unknown as Canvas2D,
    width,
    height,
  );

  // The inset last, so the drawings are never painted over it, and drawn even
  // when there are no drawings at all — an inset is a thing worth exporting on
  // its own.
  if (input.inset) paintPitchInset(ctx as unknown as Canvas2D, input.inset);

  return canvas.toDataURL("image/png");
}
