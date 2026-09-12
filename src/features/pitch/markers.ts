import type { Rect } from "@/lib/annotate/geometry";

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
