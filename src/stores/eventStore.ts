import { create } from "zustand";
import type { EventRow } from "@/lib/db/queries/events";
import * as eventsQuery from "@/lib/db/queries/events";
import { useAnnotationStore } from "@/stores/annotationStore";
import { useLibraryStore } from "@/stores/libraryStore";

/**
 * A ready-to-store event.
 *
 * The display fields travel with the draft rather than being re-queried, so a
 * capture costs exactly one round trip — the keypress has to become a visible
 * event well inside the 100 ms budget in NFR-3.
 */
export type EventDraft = {
  matchId: number;
  videoId: number;
  tagId: number;
  tagName: string;
  tagColor: string | null;
  categoryName: string;
  teamId: number | null;
  teamName: string | null;
  playerId: number | null;
  playerName: string | null;
  anchorMs: number;
  startMs: number;
  endMs: number;
};

type EventState = {
  events: EventRow[];
  /** The most recent capture, highlighted so it can be corrected at once (FR-5.3). */
  lastCapturedId: number | null;
  /** Ids of captures that can still be undone, oldest first. */
  undoStack: number[];
  error: string | null;

  /** Narrowing applied to both the timeline and the event list (FR-13). */
  filters: EventFilters;

  load: (matchId: number) => Promise<void>;
  clear: () => void;
  /** Stores one event and returns its id, so a phase can open a session on it. */
  insert: (draft: EventDraft) => Promise<number | null>;
  undoLast: () => Promise<void>;
  adjustEnd: (eventId: number, deltaMs: number) => Promise<void>;
  /** Moves or trims an event's clip range, and the moment with it (FR-6.3). */
  setEventRange: (
    eventId: number,
    range: { startMs: number; endMs: number; anchorMs?: number },
  ) => Promise<void>;
  /** Splits an event at a moment into two, the first keeping its drawings (FR-6.3). */
  splitEvent: (eventId: number, atMs: number) => Promise<void>;
  updateNotes: (eventId: number, notes: string) => Promise<void>;
  remove: (eventId: number) => Promise<void>;
  setFilters: (patch: Partial<EventFilters>) => void;
  toggleTagFilter: (tagId: number) => void;
  clearFilters: () => void;
  reportError: (message: string) => void;
  clearError: () => void;
};

export type EventFilters = {
  /** Empty means every tag. */
  tagIds: number[];
  teamId: number | null;
  playerId: number | null;
};

export const NO_FILTERS: EventFilters = { tagIds: [], teamId: null, playerId: null };

const MAX_UNDO = 50;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Keeps the list in the same order the database would return (start, then id). */
export function insertInOrder(events: EventRow[], row: EventRow): EventRow[] {
  const next = [...events];
  const at = next.findIndex(
    (candidate) =>
      candidate.startMs > row.startMs ||
      (candidate.startMs === row.startMs && candidate.id > row.id),
  );
  if (at === -1) next.push(row);
  else next.splice(at, 0, row);
  return next;
}

/** Re-orders a list after a range edit moved a row in time. */
function sortInOrder(events: EventRow[]): EventRow[] {
  return [...events].sort((a, b) => a.startMs - b.startMs || a.id - b.id);
}

/** The events a filter lets through; an empty tag list means every tag. */
export function applyFilters(events: EventRow[], filters: EventFilters): EventRow[] {
  if (!isFilterActive(filters)) return events;

  return events.filter((event) => {
    if (filters.tagIds.length > 0 && !filters.tagIds.includes(event.tagId)) return false;
    if (filters.teamId !== null && event.teamId !== filters.teamId) return false;
    if (filters.playerId !== null && event.playerId !== filters.playerId) return false;
    return true;
  });
}

export function isFilterActive(filters: EventFilters): boolean {
  return filters.tagIds.length > 0 || filters.teamId !== null || filters.playerId !== null;
}

export const useEventStore = create<EventState>((set, get) => ({
  events: [],
  lastCapturedId: null,
  undoStack: [],
  error: null,
  filters: NO_FILTERS,

  async load(matchId) {
    try {
      set({ events: await eventsQuery.listEvents(matchId) });
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  clear() {
    set({ events: [], lastCapturedId: null, undoStack: [], error: null, filters: NO_FILTERS });
  },

  /**
   * Stores one event and shows it. The single write path: the keyboard and the
   * timeline's range selection both end up here.
   *
   * The insert is awaited before the event is shown, which is simpler than an
   * optimistic row and still far inside the latency budget — and it means a
   * visible event is always a stored event.
   */
  async insert(draft) {
    try {
      const id = await eventsQuery.createEvent({
        matchId: draft.matchId,
        videoId: draft.videoId,
        tagId: draft.tagId,
        teamId: draft.teamId,
        playerId: draft.playerId,
        anchorMs: draft.anchorMs,
        startMs: draft.startMs,
        endMs: draft.endMs,
      });

      const row: EventRow = { id, notes: null, ...draft };

      set((state) => ({
        events: insertInOrder(state.events, row),
        lastCapturedId: id,
        undoStack: [...state.undoStack, id].slice(-MAX_UNDO),
        error: null,
      }));
      return id;
    } catch (error) {
      set({ error: messageOf(error) });
      return null;
    }
  },

  /** Removes the most recent capture (FR-5.3). */
  async undoLast() {
    const { undoStack, events } = get();
    const id = undoStack.at(-1);
    if (id === undefined) return;

    const row = events.find((candidate) => candidate.id === id);

    set((state) => ({
      undoStack: state.undoStack.slice(0, -1),
      events: state.events.filter((candidate) => candidate.id !== id),
      lastCapturedId:
        state.lastCapturedId === id ? (state.undoStack.at(-2) ?? null) : state.lastCapturedId,
    }));

    try {
      await eventsQuery.deleteEvent(id);
    } catch (error) {
      // Put it back rather than pretending the undo worked.
      set((state) => ({
        error: messageOf(error),
        events: row ? insertInOrder(state.events, row) : state.events,
      }));
    }
  },

  /** Extends or trims the last event's end before moving on (FR-5.3). */
  async adjustEnd(eventId, deltaMs) {
    const row = get().events.find((candidate) => candidate.id === eventId);
    if (!row) return;
    await get().setEventRange(eventId, {
      startMs: row.startMs,
      endMs: Math.max(row.startMs, row.endMs + deltaMs),
    });
  },

  /**
   * Moves or trims a span (FR-6.3).
   *
   * Applied locally first, so a drag follows the pointer rather than the
   * database, and put back if the write fails. The anchor travels with the range
   * when it is given — dragging a span carries its moment — and is clamped
   * inside the range, because a moment outside its own clip is a state nothing
   * else should have to handle.
   */
  async setEventRange(eventId, range) {
    const row = get().events.find((candidate) => candidate.id === eventId);
    if (!row) return;

    const startMs = Math.max(0, Math.round(range.startMs));
    const endMs = Math.max(startMs, Math.round(range.endMs));
    const anchorMs =
      range.anchorMs === undefined
        ? row.anchorMs
        : Math.min(endMs, Math.max(startMs, Math.round(range.anchorMs)));

    const patched = { startMs, endMs, anchorMs };
    set((state) => ({
      events: sortInOrder(
        state.events.map((candidate) =>
          candidate.id === eventId ? { ...candidate, ...patched } : candidate,
        ),
      ),
      error: null,
    }));

    try {
      await eventsQuery.updateEventRange(eventId, startMs, endMs, anchorMs);
    } catch (error) {
      set((state) => ({
        error: messageOf(error),
        events: sortInOrder(
          state.events.map((candidate) => (candidate.id === eventId ? row : candidate)),
        ),
      }));
    }
  },

  /**
   * Splits an event at a moment into two (FR-6.3).
   *
   * The **first** half keeps everything the event owned — its drawings, its
   * positions, its notes — because they were made about the moment it still has.
   * The second half is a new event with the same tag, team and player, anchored
   * at the split, so nothing has to be re-tagged to carry on.
   *
   * Two writes, and no transaction spans the IPC boundary, so the insert goes
   * first and is removed again if the trim fails — better a visible error than
   * two overlapping events nobody asked for.
   */
  async splitEvent(eventId, atMs) {
    const row = get().events.find((candidate) => candidate.id === eventId);
    if (!row) return;

    const at = Math.round(atMs);
    if (at <= row.startMs || at >= row.endMs) {
      set({ error: "Split the event somewhere inside its own clip range." });
      return;
    }

    const matchId = useLibraryStore.getState().currentMatch?.id;
    if (matchId === undefined) {
      set({ error: "Open a match before splitting an event." });
      return;
    }

    await get().insert({
      matchId,
      videoId: row.videoId,
      tagId: row.tagId,
      tagName: row.tagName,
      tagColor: row.tagColor,
      categoryName: row.categoryName,
      teamId: row.teamId,
      teamName: row.teamName,
      playerId: row.playerId,
      playerName: row.playerName,
      anchorMs: at,
      startMs: at,
      endMs: row.endMs,
    });

    const created = get().events.find(
      (candidate) =>
        candidate.anchorMs === at && candidate.startMs === at && candidate.id !== row.id,
    );

    await get().setEventRange(row.id, {
      startMs: row.startMs,
      endMs: at,
      // The first half keeps its own moment when it still has one.
      anchorMs: row.anchorMs <= at ? row.anchorMs : at,
    });

    if (get().error !== null && created) {
      await get().remove(created.id);
      set({ error: "The event could not be split; nothing was changed." });
    }
  },

  async updateNotes(eventId, notes) {
    try {
      await eventsQuery.updateEventNotes(eventId, notes.trim() || null);
      set((state) => ({
        events: state.events.map((candidate) =>
          candidate.id === eventId ? { ...candidate, notes: notes.trim() || null } : candidate,
        ),
      }));
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  async remove(eventId) {
    const row = get().events.find((candidate) => candidate.id === eventId);
    set((state) => ({
      events: state.events.filter((candidate) => candidate.id !== eventId),
      undoStack: state.undoStack.filter((id) => id !== eventId),
    }));

    // The drawings belong to the event, so the editor must let go of it too.
    if (useAnnotationStore.getState().eventId === eventId) {
      useAnnotationStore.getState().clear();
    }

    try {
      await eventsQuery.deleteEvent(eventId);
    } catch (error) {
      set((state) => ({
        error: messageOf(error),
        events: row ? insertInOrder(state.events, row) : state.events,
      }));
    }
  },

  setFilters(patch) {
    set((state) => ({ filters: { ...state.filters, ...patch } }));
  },

  toggleTagFilter(tagId) {
    set((state) => ({
      filters: {
        ...state.filters,
        tagIds: state.filters.tagIds.includes(tagId)
          ? state.filters.tagIds.filter((id) => id !== tagId)
          : [...state.filters.tagIds, tagId],
      },
    }));
  },

  clearFilters() {
    set({ filters: NO_FILTERS });
  },

  reportError(message) {
    set({ error: message });
  },

  clearError() {
    set({ error: null });
  },
}));
