import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureWithPhase, stopPhase, togglePhase } from "@/features/tagging/phaseCapture";
import * as eventsQuery from "@/lib/db/queries/events";
import * as phasesQuery from "@/lib/db/queries/phases";
import type { Tag } from "@/lib/db/queries/taxonomy";
import { useEventStore } from "@/stores/eventStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { usePhaseStore } from "@/stores/phaseStore";
import { useSquadStore } from "@/stores/squadStore";
import { useTagStore } from "@/stores/tagStore";

/**
 * The phase key and the moment key (FR-55.1–FR-55.3), driven through the real
 * stores with the two query modules mocked.
 *
 * What matters here is the *decision*: which press opens what, which press
 * closes what, and whether a moment is recorded as an instant inside a phase or
 * as a padded moment on its own — plus the case where the app must refuse to
 * guess and say so.
 */

vi.mock("@/lib/db/queries/events", () => ({
  createEvent: vi.fn(),
  deleteEvent: vi.fn(),
  updateEventRange: vi.fn(),
  updateEventNotes: vi.fn(),
  listEvents: vi.fn(),
  getEvent: vi.fn(),
}));

vi.mock("@/lib/db/queries/phases", () => ({
  listPhaseTagIds: vi.fn(),
  setTagPhase: vi.fn(),
  openSession: vi.fn(),
  touchSession: vi.fn(),
  closeSession: vi.fn(),
  listSessions: vi.fn(),
  linkParent: vi.fn(),
  listLinksForMatch: vi.fn(),
  countActionsOfPhase: vi.fn(),
}));

const createEvent = vi.mocked(eventsQuery.createEvent);
const updateEventRange = vi.mocked(eventsQuery.updateEventRange);
const openSession = vi.mocked(phasesQuery.openSession);
const closeSession = vi.mocked(phasesQuery.closeSession);
const linkParent = vi.mocked(phasesQuery.linkParent);

const HOME = 5;
const AWAY = 9;

/** The full team row the squad store holds, so the id/name pair is typed. */
function team(id: number, name: string) {
  return { id, name, color: null, shortName: null, createdAt: 0 };
}

function tag(id: number, name: string, shortcutKey: string): Tag {
  return {
    id,
    categoryId: 1,
    parentId: null,
    name,
    color: null,
    shortcutKey,
    sortOrder: id,
    createdAt: 0,
  };
}

const attacking = tag(1, "Attacking", "1");
const buildUp = tag(2, "Build up", "2");
const pressing = tag(3, "High press", "3");
const passing = tag(4, "Pass", "4");

beforeEach(() => {
  vi.clearAllMocks();
  createEvent.mockResolvedValue(101);
  useLibraryStore.setState({ currentMatchId: 7, activeVideoId: 3 });
  useEventStore.setState({ events: [], undoStack: [], lastCapturedId: null, error: null });
  usePhaseStore.setState({
    phaseTagIds: [attacking.id, buildUp.id, pressing.id],
    open: [],
    links: [],
    closures: {},
    error: null,
  });
  useTagStore.setState({
    categories: [],
    tags: [attacking, buildUp, pressing, passing],
    activeTeamId: HOME,
    activePlayerId: null,
  });
  useSquadStore.setState({
    teams: { [HOME]: team(HOME, "Manchester United") },
    players: {},
  });
});

/** The phase store's own read of what is running. */
const openPhaseStore = () => usePhaseStore.getState().open;

describe("a phase key", () => {
  it("opens a phase at the playhead and writes the session with the event", async () => {
    await togglePhase(attacking, 30_000);

    // The event starts as an instant: its length is the passage, unknown until
    // the phase stops.
    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tagId: attacking.id,
        anchorMs: 30_000,
        startMs: 30_000,
        endMs: 30_000,
      }),
    );
    expect(openSession).toHaveBeenCalledWith({
      eventId: 101,
      streamKey: `team:${HOME}`,
      openedAtMs: 30_000,
    });
    expect(openPhaseStore()).toEqual([
      {
        eventId: 101,
        tagId: attacking.id,
        streamKey: `team:${HOME}`,
        teamId: HOME,
        startedAtMs: 30_000,
      },
    ]);
  });

  it("stops the same phase on a second press, and says who stopped it", async () => {
    await togglePhase(attacking, 30_000);
    await togglePhase(attacking, 72_000);

    expect(updateEventRange).toHaveBeenCalledWith(101, 30_000, 72_000, 30_000);
    expect(closeSession).toHaveBeenCalledWith(101, "user");
    expect(openPhaseStore()).toEqual([]);
    expect(usePhaseStore.getState().closures[101]).toBe("user");
  });

  it("closes the previous phase of the same team as a later phase starts", async () => {
    await togglePhase(attacking, 30_000);
    await togglePhase(buildUp, 90_000);

    // No silent gap: the replaced phase ends exactly where the next begins, and
    // the reason is recorded rather than looking like it was stopped by hand.
    expect(updateEventRange).toHaveBeenCalledWith(101, 30_000, 90_000, 30_000);
    expect(closeSession).toHaveBeenCalledWith(101, "new-phase");
    expect(openPhaseStore().map((phase) => phase.tagId)).toEqual([buildUp.id]);
  });

  it("lets two teams' phases run together", async () => {
    await togglePhase(attacking, 30_000);

    useTagStore.setState({ activeTeamId: AWAY });
    useSquadStore.setState({ teams: { [AWAY]: team(AWAY, "Sabah") }, players: {} });
    createEvent.mockResolvedValue(202);
    await togglePhase(pressing, 33_000);

    // The defending side's phase is not the attacking side's phase (FR-55.2).
    expect(closeSession).not.toHaveBeenCalled();
    expect(openPhaseStore().map((phase) => phase.streamKey)).toEqual([
      `team:${HOME}`,
      `team:${AWAY}`,
    ]);
  });
});

describe("a moment key", () => {
  it("records the instant and links it to the open phase", async () => {
    await togglePhase(attacking, 30_000);
    createEvent.mockResolvedValue(303);

    await captureWithPhase({ tag: passing, anchorMs: 45_000, startMs: 37_000, endMs: 57_000 });

    // The roll range the caller computed is ignored: inside a phase the action is
    // the instant, so no invented time can reach a duration (D41).
    expect(createEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ anchorMs: 45_000, startMs: 45_000, endMs: 45_000 }),
    );
    expect(linkParent).toHaveBeenCalledWith(303, 101);
  });

  it("attaches the other team's action to the only open phase", async () => {
    await togglePhase(attacking, 30_000);
    createEvent.mockResolvedValue(404);
    // The active team is the defending side, whose own phase is not open.
    useTagStore.setState({ activeTeamId: AWAY });

    await captureWithPhase({ tag: pressing, anchorMs: 40_000, startMs: 32_000, endMs: 52_000 });

    expect(linkParent).toHaveBeenCalledWith(404, 101);
  });

  it("refuses to guess when two phases of other teams are open, and says so", async () => {
    await togglePhase(attacking, 30_000);
    useTagStore.setState({ activeTeamId: AWAY });
    useSquadStore.setState({ teams: { [AWAY]: team(AWAY, "Sabah") }, players: {} });
    createEvent.mockResolvedValue(202);
    await togglePhase(pressing, 33_000);

    createEvent.mockResolvedValue(505);
    useTagStore.setState({ activeTeamId: 77 });
    await captureWithPhase({ tag: passing, anchorMs: 40_000, startMs: 32_000, endMs: 52_000 });

    expect(linkParent).not.toHaveBeenCalled();
    expect(usePhaseStore.getState().error).toMatch(/more than one phase is open/i);
  });

  it("keeps a moment's own padding when nothing is open", async () => {
    createEvent.mockResolvedValue(606);

    await captureWithPhase({ tag: passing, anchorMs: 45_000, startMs: 37_000, endMs: 57_000 });

    // R0's behaviour, untouched: a moment is captured with pre-roll and post-roll.
    expect(createEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ anchorMs: 45_000, startMs: 37_000, endMs: 57_000 }),
    );
    expect(linkParent).not.toHaveBeenCalled();
    expect(usePhaseStore.getState().error).toBeNull();
  });
});

describe("stopping a phase", () => {
  it("stops the phase of a stream, which is what the toolbar button calls", async () => {
    await togglePhase(attacking, 30_000);
    await stopPhase(`team:${HOME}`, 95_000);

    expect(updateEventRange).toHaveBeenCalledWith(101, 30_000, 95_000, 30_000);
    expect(closeSession).toHaveBeenCalledWith(101, "user");
    expect(openPhaseStore()).toEqual([]);
  });

  it("says so when a phase ends with no length, instead of letting it look lost", async () => {
    // At a fitted zoom the bar is a three-pixel tick, so a phase stopped where it
    // started has to be reported rather than left for the user to hunt for.
    await togglePhase(attacking, 30_000);
    await stopPhase(`team:${HOME}`, 30_200);

    expect(usePhaseStore.getState().error).toMatch(/no length yet/i);
  });

  it("says nothing when the passage had real time in it", async () => {
    await togglePhase(attacking, 30_000);
    await stopPhase(`team:${HOME}`, 45_000);

    expect(usePhaseStore.getState().error).toBeNull();
  });

  it("does nothing when nothing is running in that stream", async () => {
    await stopPhase(`team:${HOME}`, 45_000);

    expect(updateEventRange).not.toHaveBeenCalled();
    expect(closeSession).not.toHaveBeenCalled();
  });
});
