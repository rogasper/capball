import { type RefObject, useEffect, useState } from "react";
import { contentRect, type Rect } from "@/lib/annotate/geometry";

/**
 * The rectangle inside the stage that the video picture actually occupies.
 *
 * `object-fit: contain` letterboxes the picture inside the element, and the
 * letterbox depends on the window's aspect, so everything drawn over the video —
 * annotations and the calibration outline alike — has to be placed on this rect
 * rather than on the element. Extracted so both layers measure it the same way:
 * two copies of this would eventually disagree, and the disagreement would only
 * be visible in a window shape nobody tested.
 */
export function useContentRect(
  stageRef: RefObject<HTMLElement | null>,
  videoRef: RefObject<HTMLVideoElement | null>,
): Rect {
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });

  useEffect(() => {
    const stage = stageRef.current;
    const video = videoRef.current;
    if (!stage || !video) return;

    const measure = () => {
      const next = contentRect(
        stage.clientWidth,
        stage.clientHeight,
        video.videoWidth,
        video.videoHeight,
      );
      setRect((prev) =>
        prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h
          ? prev
          : next,
      );
    };

    measure();
    video.addEventListener("loadedmetadata", measure);
    video.addEventListener("resize", measure);

    // jsdom has no ResizeObserver; this only matters in a real window.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(stage);

    return () => {
      observer?.disconnect();
      video.removeEventListener("loadedmetadata", measure);
      video.removeEventListener("resize", measure);
    };
  }, [stageRef, videoRef]);

  return rect;
}
