import type { Rect } from "@/lib/annotate/geometry";

/** Anything that reports its own box the way `getBoundingClientRect` does. */
export type BoxLike = { left: number; top: number; width: number; height: number };

/**
 * A client point as **frame-normalised** coordinates inside a box.
 *
 * The box is the picture's own rect — the canvas *is* the picture by
 * construction — so measuring against it can never disagree with where the click
 * landed, and there is nothing held in React state to go stale between a
 * re-measure and a click. Returns null for a zero-sized box, which is what a
 * hidden or not-yet-laid-out element reports.
 */
export function normaliseFromBox(
  box: BoxLike,
  clientX: number,
  clientY: number,
): [number, number] | null {
  if (box.width <= 0 || box.height <= 0) return null;
  return [(clientX - box.left) / box.width, (clientY - box.top) / box.height];
}

/**
 * Where a reference point's numbered marker goes, in **picture-relative** pixels.
 *
 * The marker layer is positioned on the picture's own box, so these coordinates
 * must not carry the picture's offset as well. Adding it in both places is a
 * double offset — it put every marker a letterbox-width to the right of the click
 * it belonged to, which reads as "the calibration ignores where I clicked" even
 * though the stored point and the outline were correct all along.
 *
 * One place applies the offset, and it is the wrapper the markers live in.
 */
export function pickMarkers(
  picks: { feature: string; imageU: number; imageV: number }[],
  rect: Rect,
): { feature: string; point: [number, number] }[] {
  return picks.map((pick) => ({
    feature: pick.feature,
    point: [pick.imageU * rect.w, pick.imageV * rect.h],
  }));
}

/**
 * The same contract for player positions.
 *
 * Deliberately the same shape as `pickMarkers`: both layers live in a wrapper
 * that carries the picture's box, so both must return positions inside it. The
 * calibration markers once added the offset here *and* in the wrapper, which put
 * every dot a letterbox away from its click; sharing one tested helper is how
 * that cannot come back for the positions.
 */
export function markerOffsets(
  items: { id: number; imageU: number; imageV: number }[],
  rect: Rect,
): { id: number; point: [number, number] }[] {
  return items.map((item) => ({
    id: item.id,
    point: [item.imageU * rect.w, item.imageV * rect.h],
  }));
}
