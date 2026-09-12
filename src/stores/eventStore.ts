import { create } from "zustand";
import type { EventRow } from "@/lib/db/queries/events";
import * as eventsQuery from "@/lib/db/queries/events";

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
  insert: (draft: EventDraft) => Promise<void>;
  undoLast: () => Promise<void>;
  adjustEnd: (eventId: number, deltaMs: number) => Promise<void>;
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
    } catch (error) {
      set({ error: messageOf(error) });
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

    const endMs = Math.max(row.startMs, row.endMs + deltaMs);

    set((state) => ({
      events: state.events.map((candidate) =>
        candidate.id === eventId ? { ...candidate, endMs } : candidate,
      ),
    }));

    try {
      await eventsQuery.updateEventRange(eventId, row.startMs, endMs);
    } catch (error) {
      set((state) => ({
        error: messageOf(error),
        events: state.events.map((candidate) => (candidate.id === eventId ? row : candidate)),
      }));
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
