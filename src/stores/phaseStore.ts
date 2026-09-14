import { create } from "zustand";
import * as eventsQuery from "@/lib/db/queries/events";
import * as phasesQuery from "@/lib/db/queries/phases";
import {
  closureReason,
  interruptedEndMs,
  type OpenPhase,
  type ParentLink,
  type ParentResolution,
  type PhaseClosure,
  parentForMoment,
  streamKeyOf,
  wouldCycle,
} from "@/lib/phases/rules";
import { useEventStore } from "@/stores/eventStore";

/**
 * Which phase is running, and what the actions inside it belong to (FR-55).
 *
 * The store holds **identity**, never a clock: which phase is open per stream
 * and when it started. How long its bar is comes from the playback controller
 * and is written straight onto the element by the timeline, because playback
 * time in a store would re-render the tree every frame (architecture rule 4).
 *
 * The database is the authority on what is open — a `phase_sessions` row with a
 * null `closed_by` — so a stale flag can never disagree with it. On load, any
 * row still open is recovered as closed at the last position that was recorded
 * while it ran, which is what makes an interrupted phase claim only what was
 * observed (FR-55.4).
 *
 * The store does not decide *which* tag press starts or stops a phase: that is
 * `features/tagging/phaseCapture.ts`, which has the key context. Here is only the
 * session, so the rule that a press means "start or stop" cannot drift from the
 * rule that a press means "record a moment".
 */

/** The last position written for the open session, to throttle the writes. */
const LAST_SEEN_WRITE_MS = 5_000;

type PhaseState = {
  /** Tags that open a phase (FR-55.1). */
  phaseTagIds: number[];
  /** The open phases, at most one per stream (FR-55.2). */
  open: OpenPhase[];
  /** Parent links of the open match, so an action can name its phase. */
  links: ParentLink[];
  /** How each phase ended, by event id; `null` while one is open. */
  closures: Record<number, PhaseClosure | null>;
  error: string | null;

  load: (matchId: number) => Promise<void>;
  clear: () => void;
  isPhase: (tagId: number) => boolean;
  setPhaseTag: (tagId: number, isPhase: boolean) => Promise<void>;

  /** Marks a stored event as the open phase of its stream (FR-55.4). */
  openPhase: (input: {
    eventId: number;
    tagId: number;
    teamId: number | null;
    atMs: number;
  }) => Promise<void>;
  /** Ends a phase for a stated reason, writing both the range and the session. */
  close: (streamKey: string, reason: PhaseClosure, atMs: number) => Promise<void>;
  /** Closes whatever is open because the footage ran out. */
  closeAllForVideoEnd: (durationMs: number) => Promise<void>;
  /** Records the last observed position, at most every five seconds. */
  touch: (eventId: number, timeMs: number) => void;

  /** What an action pressed now belongs to, without writing anything. */
  parentFor: (teamId: number | null) => ParentResolution;
  /** Writes the link an action belongs to, refusing one that would cycle. */
  linkAction: (childId: number, parentId: number) => Promise<boolean>;
  actionsOf: (parentId: number) => Promise<number>;
  reportError: (message: string) => void;
  clearError: () => void;
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The last position actually written, per event; module state, never rendered. */
const lastSeenWritten = new Map<number, number>();

export const usePhaseStore = create<PhaseState>((set, get) => ({
  phaseTagIds: [],
  open: [],
  links: [],
  closures: {},
  error: null,

  /**
   * Loads the phase state of a match and recovers anything left open.
   *
   * Recovery writes the event's end **before** the caller reloads the events, so
   * the row the timeline reads is already the recovered one — there is no moment
   * where a phase looks like it is still running after a restart.
   */
  async load(matchId) {
    try {
      const [phaseTagIds, sessions] = await Promise.all([
        phasesQuery.listPhaseTagIds(),
        phasesQuery.listSessions(matchId),
      ]);

      const closures: Record<number, PhaseClosure | null> = {};
      for (const session of sessions) {
        if (session.closedBy !== null) {
          closures[session.eventId] = session.closedBy;
          continue;
        }

        // Left open by an exit: close it at what was observed, never at the end.
        // Written through the query layer rather than the event store: recovery
        // runs *before* the events are loaded, so a row this store cannot see is
        // still a row the database must be told about.
        const endMs = interruptedEndMs(session.openedAtMs, session.lastSeenMs);
        const reason = closureReason("exit", session.lastSeenMs > session.openedAtMs);
        await eventsQuery.updateEventRange(
          session.eventId,
          session.openedAtMs,
          endMs,
          session.openedAtMs,
        );
        await phasesQuery.closeSession(session.eventId, reason);
        closures[session.eventId] = reason;
      }

      set({
        phaseTagIds,
        open: [],
        links: await phasesQuery.listLinksForMatch(matchId),
        closures,
        error: null,
      });
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  clear() {
    lastSeenWritten.clear();
    set({ phaseTagIds: [], open: [], links: [], closures: {}, error: null });
  },

  isPhase(tagId) {
    return get().phaseTagIds.includes(tagId);
  },

  async setPhaseTag(tagId, isPhase) {
    const running = get().open.find((phase) => phase.tagId === tagId);

    // Turning a running phase back into a one-press tag would end the passage
    // being recorded, and the bar the user was watching would turn into a plain
    // three-pixel event. Refusing is the only answer that cannot look like loss.
    if (!isPhase && running) {
      set({ error: "Stop that phase before turning its tag back into a one-press tag." });
      return;
    }

    try {
      await phasesQuery.setTagPhase(tagId, isPhase);
      set((state) => ({
        phaseTagIds: isPhase
          ? [...state.phaseTagIds, tagId]
          : state.phaseTagIds.filter((id) => id !== tagId),
        error: null,
      }));
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  /**
   * Marks a stored event as the open phase of its stream.
   *
   * The event is already written when this runs: an open phase must exist on
   * disk from its first instant, and the session row is what turns it from a
   * zero-length event into a passage that is running (FR-5.4, FR-55.4).
   */
  async openPhase(input) {
    const streamKey = streamKeyOf(input.teamId);

    try {
      await phasesQuery.openSession({
        eventId: input.eventId,
        streamKey,
        openedAtMs: input.atMs,
      });
      lastSeenWritten.set(input.eventId, input.atMs);
      set((state) => ({
        open: [
          ...state.open.filter((candidate) => candidate.streamKey !== streamKey),
          {
            eventId: input.eventId,
            tagId: input.tagId,
            streamKey,
            teamId: input.teamId,
            startedAtMs: input.atMs,
          },
        ],
        closures: { ...state.closures, [input.eventId]: null },
        error: null,
      }));
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  async close(streamKey, reason, atMs) {
    const phase = get().open.find((candidate) => candidate.streamKey === streamKey);
    if (!phase) return;

    const endMs = Math.max(phase.startedAtMs, Math.round(atMs));

    set((state) => ({
      open: state.open.filter((candidate) => candidate.streamKey !== streamKey),
      closures: { ...state.closures, [phase.eventId]: reason },
    }));

    await useEventStore.getState().setEventRange(phase.eventId, {
      startMs: phase.startedAtMs,
      endMs,
      anchorMs: phase.startedAtMs,
    });

    try {
      await phasesQuery.closeSession(phase.eventId, reason);
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  async closeAllForVideoEnd(durationMs) {
    for (const phase of [...get().open]) {
      await get().close(phase.streamKey, "video-end", durationMs);
    }
  },

  /**
   * Records the last observed position, throttled.
   *
   * Called from the frame subscription, which runs many times a second, so this
   * writes at most once per `LAST_SEEN_WRITE_MS` — and only while a phase is
   * open, which is why the common case writes nothing at all.
   */
  touch(eventId, timeMs) {
    const written = lastSeenWritten.get(eventId) ?? Number.NEGATIVE_INFINITY;
    if (timeMs - written < LAST_SEEN_WRITE_MS) return;

    lastSeenWritten.set(eventId, timeMs);
    void phasesQuery.touchSession(eventId, timeMs).catch((error: unknown) => {
      set({ error: messageOf(error) });
    });
  },

  parentFor(teamId) {
    return parentForMoment(teamId, get().open);
  },

  /**
   * Attaches an action to its phase.
   *
   * The cycle guard runs at the write boundary rather than only in the rule that
   * chose the parent: whatever future path picks a parent, a link that would make
   * a phase its own ancestor is refused here (D38).
   */
  async linkAction(childId, parentId) {
    if (wouldCycle(get().links, childId, parentId)) {
      set({ error: "That would put the phase inside itself." });
      return false;
    }

    try {
      await phasesQuery.linkParent(childId, parentId);
      set((state) => ({
        links: [...state.links, { childId, parentId }],
        error: null,
      }));
      return true;
    } catch (error) {
      set({ error: messageOf(error) });
      return false;
    }
  },

  actionsOf(parentId) {
    return phasesQuery.countActionsOfPhase(parentId);
  },

  reportError(message) {
    set({ error: message });
  },

  clearError() {
    set({ error: null });
  },
}));
