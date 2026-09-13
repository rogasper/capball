import { create } from "zustand";
import type { PositionRow } from "@/lib/db/queries/positions";
import * as positionsQuery from "@/lib/db/queries/positions";

/**
 * The positions of the selected event (FR-30.3, FR-30.6).
 *
 * The geometry — where a click lands, whether it is on the pitch, whether the
 * calibration actually covers it — is decided before this store is called, by the
 * pure functions in `lib/pitch/positions.ts`. What lives here is the data and the
 * marking mode, so a click that was refused never reaches the database.
 */

/** Who a click will be attributed to, with the fields a marker needs to draw. */
export type MarkingTarget = {
  playerId: number;
  playerName: string;
  shirtNumber: number | null;
  teamId: number;
  teamName: string;
  teamColor: string | null;
};

type PositionState = {
  /** The event whose positions are open. */
  eventId: number | null;
  positions: PositionRow[];
  /** True while clicks on the video are placing positions. */
  marking: boolean;
  /** The player the next click will be attributed to. */
  target: MarkingTarget | null;
  error: string | null;
  /** A position was stored, but with something worth saying (a coverage warning). */
  notice: string | null;

  load: (eventId: number) => Promise<void>;
  clear: () => void;
  setMarking: (marking: boolean) => void;
  setTarget: (target: MarkingTarget | null) => void;
  /** Stores a position the caller has already derived and accepted. */
  place: (input: {
    uid: string;
    calibrationId: number | null;
    imageU: number;
    imageV: number;
    xM: number;
    yM: number;
  }) => Promise<void>;
  remove: (id: number) => Promise<void>;
  /** Another event's positions, for the comparison view (FR-30.7). */
  loadFor: (eventId: number) => Promise<PositionRow[]>;
  /** How many positions an event holds, for the deletion confirmation. */
  countFor: (eventId: number) => Promise<number>;
  reportError: (message: string) => void;
  reportNotice: (message: string | null) => void;
  clearError: () => void;
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const usePositionStore = create<PositionState>((set, get) => ({
  eventId: null,
  positions: [],
  marking: false,
  target: null,
  error: null,
  notice: null,

  async load(eventId) {
    try {
      set({
        eventId,
        positions: await positionsQuery.listPositions(eventId),
        error: null,
        notice: null,
      });
    } catch (error) {
      set({ eventId, positions: [], error: messageOf(error) });
    }
  },

  clear() {
    set({ eventId: null, positions: [], marking: false, target: null, error: null, notice: null });
  },

  setMarking(marking) {
    set({ marking, error: null, notice: null });
  },

  setTarget(target) {
    set({ target, notice: null, error: null });
  },

  async place(input) {
    const { eventId, positions, target } = get();
    if (eventId === null || target === null) return;

    try {
      const id = await positionsQuery.savePosition({
        uid: input.uid,
        eventId,
        playerId: target.playerId,
        teamId: target.teamId,
        calibrationId: input.calibrationId,
        imageU: input.imageU,
        imageV: input.imageV,
        xM: input.xM,
        yM: input.yM,
      });

      // Replacing the same player's marker keeps the row's own uid: the write is
      // an update, so the identity that transfer is idempotent by does not change.
      const existing = positions.find((candidate) => candidate.playerId === target.playerId);
      const row: PositionRow = {
        id,
        uid: existing?.uid ?? input.uid,
        eventId,
        playerId: target.playerId,
        playerName: target.playerName,
        shirtNumber: target.shirtNumber,
        teamId: target.teamId,
        teamName: target.teamName,
        teamColor: target.teamColor,
        calibrationId: input.calibrationId,
        imageU: input.imageU,
        imageV: input.imageV,
        xM: input.xM,
        yM: input.yM,
      };

      // Replacing the same player's marker is a correction, not a duplicate.
      const without = positions.filter((candidate) => candidate.playerId !== target.playerId);
      set({ positions: [...without, row], error: null });
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  async remove(id) {
    const removed = get().positions.find((position) => position.id === id);
    if (!removed) return;

    set((state) => ({ positions: state.positions.filter((position) => position.id !== id) }));

    try {
      await positionsQuery.deletePosition(id);
    } catch (error) {
      set((state) => ({
        positions: [...state.positions, removed],
        error: messageOf(error),
      }));
    }
  },

  async loadFor(eventId) {
    try {
      return await positionsQuery.listPositions(eventId);
    } catch (error) {
      set({ error: messageOf(error) });
      return [];
    }
  },

  async countFor(eventId) {
    if (get().eventId === eventId) return get().positions.length;
    try {
      return await positionsQuery.countPositions(eventId);
    } catch (error) {
      set({ error: messageOf(error) });
      return 0;
    }
  },

  reportError(message) {
    set({ error: message });
  },

  reportNotice(message) {
    set({ notice: message });
  },

  clearError() {
    set({ error: null });
  },
}));

/** Positions grouped by team, for drawing one team at a time. */
export function byTeam(positions: PositionRow[]): Map<number, PositionRow[]> {
  const grouped = new Map<number, PositionRow[]>();
  for (const position of positions) {
    const list = grouped.get(position.teamId);
    if (list) list.push(position);
    else grouped.set(position.teamId, [position]);
  }
  return grouped;
}
