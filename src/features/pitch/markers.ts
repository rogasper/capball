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
