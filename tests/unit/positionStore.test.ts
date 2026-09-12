import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PositionRow } from "@/lib/db/queries/positions";
import * as positionsQuery from "@/lib/db/queries/positions";
import { byTeam, usePositionStore } from "@/stores/positionStore";

/**
 * The position store is the data owner: the geometry (whether a click is on the
 * pitch, whether the calibration covers it) is decided before it is called, so
 * what is tested here is identity, replacement and the optimistic edits.
 */

vi.mock("@/lib/db/queries/positions", () => ({
  listPositions: vi.fn(),
  savePosition: vi.fn(),
  deletePosition: vi.fn(),
  countPositions: vi.fn(),
}));

const listPositions = vi.mocked(positionsQuery.listPositions);
const savePosition = vi.mocked(positionsQuery.savePosition);
const deletePosition = vi.mocked(positionsQuery.deletePosition);
const countPositions = vi.mocked(positionsQuery.countPositions);

function row(id: number, playerId: number, patch: Partial<PositionRow> = {}): PositionRow {
  return {
    id,
    eventId: 7,
    playerId,
    playerName: `Player ${playerId}`,
    shirtNumber: playerId,
    teamId: 1,
    teamName: "Manchester United",
    teamColor: "#DA291C",
    calibrationId: 3,
    imageU: 0.4,
    imageV: 0.5,
    xM: -10,
    yM: 5,
    ...patch,
  };
}

const target = {
  playerId: 11,
  playerName: "Bruno Fernandes",
  shirtNumber: 8,
  teamId: 1,
  teamName: "Manchester United",
  teamColor: "#DA291C",
};

beforeEach(() => {
  vi.clearAllMocks();
  usePositionStore.setState({
    eventId: null,
    positions: [],
    marking: false,
    target: null,
    error: null,
    notice: null,
  });
  savePosition.mockResolvedValue(99);
  deletePosition.mockResolvedValue(undefined);
  listPositions.mockResolvedValue([]);
  countPositions.mockResolvedValue(0);
});

describe("loading", () => {
  it("opens an event's positions", async () => {
    listPositions.mockResolvedValue([row(1, 11)]);
    await usePositionStore.getState().load(7);
    expect(usePositionStore.getState().positions).toHaveLength(1);
    expect(usePositionStore.getState().eventId).toBe(7);
  });

  it("reports a read failure instead of an empty moment", async () => {
    listPositions.mockRejectedValue(new Error("database is locked"));
    await usePositionStore.getState().load(7);
    expect(usePositionStore.getState().error).toMatch(/locked/);
  });

  it("reads another event's positions without disturbing the open one", async () => {
    listPositions.mockResolvedValue([row(5, 12)]);
    await usePositionStore.getState().load(7);

    const other = await usePositionStore.getState().loadFor(8);

    expect(other).toHaveLength(1);
    expect(usePositionStore.getState().eventId).toBe(7);
  });
});

describe("marking", () => {
  it("does nothing without an event or a player", async () => {
    await usePositionStore.getState().place({
      uid: "u",
      calibrationId: 3,
      imageU: 0.4,
      imageV: 0.5,
      xM: 0,
      yM: 0,
    });
    expect(savePosition).not.toHaveBeenCalled();
  });

  it("stores a position for the chosen player and shows it at once", async () => {
    await usePositionStore.getState().load(7);
    usePositionStore.getState().setTarget(target);

    await usePositionStore.getState().place({
      uid: "u1",
      calibrationId: 3,
      imageU: 0.42,
      imageV: 0.58,
      xM: -14.25,
      yM: 6.75,
    });

    expect(savePosition.mock.calls[0][0]).toMatchObject({
      eventId: 7,
      playerId: 11,
      teamId: 1,
      calibrationId: 3,
      xM: -14.25,
    });
    const [stored] = usePositionStore.getState().positions;
    expect(stored.playerName).toBe("Bruno Fernandes");
    expect(stored.teamColor).toBe("#DA291C");
    expect(stored.xM).toBeCloseTo(-14.25);
  });

  it("treats a second marker on the same player as a correction", async () => {
    await usePositionStore.getState().load(7);
    usePositionStore.getState().setTarget(target);

    await usePositionStore
      .getState()
      .place({ uid: "a", calibrationId: 3, imageU: 0.4, imageV: 0.5, xM: -10, yM: 5 });
    await usePositionStore
      .getState()
      .place({ uid: "b", calibrationId: 3, imageU: 0.5, imageV: 0.5, xM: -2, yM: 5 });

    const positions = usePositionStore.getState().positions;
    expect(positions).toHaveLength(1);
    expect(positions[0].xM).toBeCloseTo(-2);
  });

  it("keeps other players' positions when one is corrected", async () => {
    listPositions.mockResolvedValue([row(1, 12, { playerName: "Saddil Ramdani" })]);
    await usePositionStore.getState().load(7);
    usePositionStore.getState().setTarget(target);

    await usePositionStore
      .getState()
      .place({ uid: "a", calibrationId: 3, imageU: 0.4, imageV: 0.5, xM: -10, yM: 5 });

    expect(
      usePositionStore
        .getState()
        .positions.map((p) => p.playerId)
        .sort(),
    ).toEqual([11, 12]);
  });

  it("surfaces a write failure", async () => {
    await usePositionStore.getState().load(7);
    usePositionStore.getState().setTarget(target);
    savePosition.mockRejectedValue(new Error("disk full"));

    await usePositionStore
      .getState()
      .place({ uid: "a", calibrationId: 3, imageU: 0.4, imageV: 0.5, xM: 0, yM: 0 });

    expect(usePositionStore.getState().error).toMatch(/disk full/);
    expect(usePositionStore.getState().positions).toHaveLength(0);
  });

  it("removes a position, and puts it back when the write fails", async () => {
    listPositions.mockResolvedValue([row(1, 11)]);
    await usePositionStore.getState().load(7);

    await usePositionStore.getState().remove(1);
    expect(usePositionStore.getState().positions).toHaveLength(0);

    listPositions.mockResolvedValue([row(2, 12)]);
    await usePositionStore.getState().load(7);
    deletePosition.mockRejectedValue(new Error("disk full"));
    await usePositionStore.getState().remove(2);

    expect(usePositionStore.getState().positions).toHaveLength(1);
    expect(usePositionStore.getState().error).toMatch(/disk full/);
  });
});

describe("counting", () => {
  it("answers from memory for the open event and from the database otherwise", async () => {
    listPositions.mockResolvedValue([row(1, 11), row(2, 12)]);
    await usePositionStore.getState().load(7);

    expect(await usePositionStore.getState().countFor(7)).toBe(2);
    expect(countPositions).not.toHaveBeenCalled();

    countPositions.mockResolvedValue(4);
    expect(await usePositionStore.getState().countFor(9)).toBe(4);
    expect(countPositions).toHaveBeenCalledWith(9);
  });
});

describe("byTeam", () => {
  it("groups positions by the team they were marked for", () => {
    const grouped = byTeam([
      row(1, 11, { teamId: 1 }),
      row(2, 12, { teamId: 2 }),
      row(3, 13, { teamId: 1 }),
    ]);
    expect(grouped.get(1)?.map((p) => p.id)).toEqual([1, 3]);
    expect(grouped.get(2)?.map((p) => p.id)).toEqual([2]);
  });
});
