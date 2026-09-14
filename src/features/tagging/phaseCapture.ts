import type { Tag } from "@/lib/db/queries/taxonomy";
import { streamKeyOf } from "@/lib/phases/rules";
import { useEventStore } from "@/stores/eventStore";
import { usePhaseStore } from "@/stores/phaseStore";
import { useTagStore } from "@/stores/tagStore";
import { buildEventDraft } from "./captureContext";

/**
 * What a keypress does when the tag is a phase, or when a phase is running
 * (FR-55.1, FR-55.2, FR-55.3).
 *
 * Kept beside the capture path rather than inside the store: the rule "a press
 * starts or stops" and the rule "a press records a moment" are two halves of one
 * decision, and splitting them across layers is how they drift apart. The store
 * holds the session; the pure rules are in `lib/phases`.
 */

/** A phase shorter than this is reported, because it is almost always a slip. */
const MIN_MEANINGFUL_PHASE_MS = 1_000;

/**
 * Stops the phase running in a stream, because the user asked for it.
 *
 * The same path the phase's own key takes, so the two cannot disagree about what
 * "stop" means; the timeline's toolbar button exists because at a fitted zoom a
 * running phase's bar can be three pixels wide.
 */
export async function stopPhase(streamKey: string, atMs: number): Promise<void> {
  const phases = usePhaseStore.getState();
  const running = phases.open.find((phase) => phase.streamKey === streamKey);
  if (!running) return;

  await phases.close(streamKey, "user", atMs);
  reportIfEmpty(running.startedAtMs, atMs);
}

/**
 * Says so when a phase ends with no length.
 *
 * A phase stopped where it started has no duration, and at a fitted zoom its bar
 * is a three-pixel tick somewhere behind the playhead — so the honest thing is to
 * tell the user rather than let the passage look lost. The bar is still there and
 * can be trimmed.
 */
function reportIfEmpty(startedAtMs: number, endedAtMs: number): void {
  if (endedAtMs - startedAtMs >= MIN_MEANINGFUL_PHASE_MS) return;
  usePhaseStore
    .getState()
    .reportError(
      "That phase was stopped where it started, so it has no length yet. Drag its end on the timeline to give it one.",
    );
}

/**
 * The phase key: start a passage, or stop the one already running.
 *
 * A second press on the same tag stops it. A press on a **different** phase of
 * the same team replaces it — the one that was replaced is recorded as closed by
 * a later phase, so the timeline shows no silent gap. A different team's phase is
 * untouched, which is what lets the attacking and defending phases run together.
 */
export async function togglePhase(tag: Tag, atMs: number): Promise<void> {
  const phases = usePhaseStore.getState();
  const teamId = useTagStore.getState().activeTeamId;
  const streamKey = streamKeyOf(teamId);
  const running = phases.open.find((phase) => phase.streamKey === streamKey);

  if (running) {
    await phases.close(streamKey, running.tagId === tag.id ? "user" : "new-phase", atMs);
    if (running.tagId === tag.id) {
      reportIfEmpty(running.startedAtMs, atMs);
      return;
    }
  }

  // A phase event starts as an instant: its length is the passage, which is not
  // known until it stops. It is written before the session so a phase that is
  // running is also a phase that exists on disk (FR-5.4).
  const id = await useEventStore
    .getState()
    .insert(buildEventDraft(tag, { anchorMs: atMs, startMs: atMs, endMs: atMs }));
  if (id === null) return;

  await phases.openPhase({ eventId: id, tagId: tag.id, teamId, atMs });
}

/**
 * Records a moment, inside a phase when one applies.
 *
 * With a phase to belong to, the event stores the **instant** rather than a
 * padded range (D41): the phase is the context, and padding an action would put
 * invented time into a duration. With no phase open it behaves exactly as R0
 * does — pre-roll and post-roll — so tagging never depends on having started one.
 */
export async function captureWithPhase(input: {
  tag: Tag;
  anchorMs: number;
  startMs: number;
  endMs: number;
}): Promise<void> {
  const phases = usePhaseStore.getState();
  const teamId = useTagStore.getState().activeTeamId;
  const parent = phases.parentFor(teamId);
  const attaches = parent.kind === "attach";

  const id = await useEventStore.getState().insert(
    buildEventDraft(input.tag, {
      anchorMs: input.anchorMs,
      startMs: attaches ? input.anchorMs : input.startMs,
      endMs: attaches ? input.anchorMs : input.endMs,
    }),
  );
  if (id === null) return;

  if (parent.kind === "attach") {
    const linked = await phases.linkAction(id, parent.parentId);
    if (!linked) {
      phases.reportError("The moment was recorded without its phase: the link was refused.");
    }
    return;
  }

  // Several phases open and none of them this team's: saying so is better than
  // guessing which passage the moment belongs to (FR-55.3).
  if (parent.reason === "ambiguous") {
    phases.reportError(
      "Recorded without a phase: more than one phase is open and none belongs to this team.",
    );
  }
}
