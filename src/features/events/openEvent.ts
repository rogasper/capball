import type { EventRow } from "@/lib/db/queries/events";
import { playback } from "@/lib/playback";
import { useAnnotationStore } from "@/stores/annotationStore";

/**
 * Opening an event: the one place that knows what "the current moment" means.
 *
 * Seeking is not enough. The Draw and Pitch tabs work on the event the
 * annotation store has **loaded**, so anything that jumps to an event has to load
 * it too — otherwise the playhead moves, the panel still says "select an event to
 * draw on it", and drawing looks broken. The timeline's markers did exactly that
 * until it was reported from the running app: a marker click seeked and nothing
 * else, while the event list seeked and loaded.
 */
export function openEvent(event: Pick<EventRow, "id" | "anchorMs">): void {
  playback.seekMs(event.anchorMs);
  void useAnnotationStore.getState().load(event.id);
}
