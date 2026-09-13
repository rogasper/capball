import type { StoredCalibration } from "@/lib/db/queries/calibrations";
import { derivePosition, homographyOf, regionOf } from "./positions";

/**
 * Turning a click on the frame into a pitch position, in one place.
 *
 * Both the marking overlay on the video and the magnified picker place positions,
 * and a second copy of this chain would eventually disagree with the first — the
 * double-offset bug in M8 is the precedent. Pure, so it is unit-tested without a
 * DOM; the caller does the storing.
 */

export type PlacementVerdict =
  | { ok: true; xM: number; yM: number; warning: string | null }
  | { ok: false; reason: string };

export function placeOnPitch(input: {
  calibration: StoredCalibration | null;
  click: { imageU: number; imageV: number };
  frame: { width: number; height: number };
  size: { lengthM: number; widthM: number };
}): PlacementVerdict {
  const { calibration, click, frame, size } = input;

  if (!calibration || calibration.points.length < 4) {
    return {
      ok: false,
      reason: "This video is not calibrated yet, so a click has no pitch position.",
    };
  }
  if (frame.width <= 0 || frame.height <= 0) {
    return { ok: false, reason: "The video's size is not known yet. Try again in a moment." };
  }

  const solved = homographyOf(calibration.points, frame);
  if (!solved.ok) return { ok: false, reason: solved.reason };

  const verdict = derivePosition(solved.h, click, frame, size, regionOf(calibration.points, size));
  if (!verdict.ok) return { ok: false, reason: verdict.reason };

  return { ok: true, xM: verdict.xM, yM: verdict.yM, warning: verdict.warning };
}
