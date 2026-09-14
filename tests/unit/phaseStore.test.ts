import { beforeEach, describe, expect, it, vi } from "vitest";
import * as eventsQuery from "@/lib/db/queries/events";
import * as phasesQuery from "@/lib/db/queries/phases";
import { useEventStore } from "@/stores/eventStore";
import { usePhaseStore } from "@/stores/phaseStore";

/**
 * Recovering a phase the app did not get to stop (FR-55.4).
 *
 * The rule with teeth is that an interrupted phase claims **only what was
 * observed**: closed at the last position recorded while it ran, and marked as
 * closed by the exit rather than at the end of the video — which would invent the
 * duration the whole phase model exists to record.
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

const updateEventRange = vi.mocked(eventsQuery.updateEventRange);
const listSessions = vi.mocked(phasesQuery.listSessions);
const listPhaseTagIds = vi.mocked(phasesQuery.listPhaseTagIds);
const listLinksForMatch = vi.mocked(phasesQuery.listLinksForMatch);
const closeSession = vi.mocked(phasesQuery.closeSession);
const touchSession = vi.mocked(phasesQuery.touchSession);

type SessionRow = Awaited<ReturnType<typeof phasesQuery.listSessions>>[number];

const session = (overrides: Partial<SessionRow> = {}): SessionRow => ({
  eventId: 11,
  tagId: 1,
  teamId: 5,
  streamKey: "team:5",
  openedAtMs: 10_000,
  lastSeenMs: 10_000,
  closedBy: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  listPhaseTagIds.mockResolvedValue([1]);
  listSessions.mockResolvedValue([]);
  listLinksForMatch.mockResolvedValue([]);
  vi.mocked(phasesQuery.touchSession).mockResolvedValue(undefined);
  vi.mocked(phasesQuery.closeSession).mockResolvedValue(undefined);
  updateEventRange.mockResolvedValue(undefined);
  useEventStore.setState({ events: [], error: null });
  usePhaseStore.setState({
    phaseTagIds: [],
    open: [],
    links: [],
    closures: {},
    error: null,
  });
});

describe("loading a match's phases", () => {
  it("closes a phase the app exited under, at the last position it saw", async () => {
    listSessions.mockResolvedValue([session({ lastSeenMs: 48_000 })]);

    await usePhaseStore.getState().load(7);

    expect(updateEventRange).toHaveBeenCalledWith(11, 10_000, 48_000, 10_000);
    expect(closeSession).toHaveBeenCalledWith(11, "exit");
    expect(usePhaseStore.getState().closures[11]).toBe("exit");
    // Nothing is left looking like it is still running after a restart.
    expect(usePhaseStore.getState().open).toEqual([]);
  });

  it("closes it empty when no position was ever written, and says that too", async () => {
    listSessions.mockResolvedValue([session()]);

    await usePhaseStore.getState().load(7);

    expect(updateEventRange).toHaveBeenCalledWith(11, 10_000, 10_000, 10_000);
    expect(closeSession).toHaveBeenCalledWith(11, "empty");
    expect(usePhaseStore.getState().closures[11]).toBe("empty");
  });

  it("leaves a phase that was already closed alone", async () => {
    listSessions.mockResolvedValue([session({ lastSeenMs: 48_000, closedBy: "user" })]);

    await usePhaseStore.getState().load(7);

    expect(updateEventRange).not.toHaveBeenCalled();
    expect(closeSession).not.toHaveBeenCalled();
    expect(usePhaseStore.getState().closures[11]).toBe("user");
  });

  it("reads the phase tags and the links of the match", async () => {
    listLinksForMatch.mockResolvedValue([{ childId: 30, parentId: 11 }]);

    await usePhaseStore.getState().load(7);

    expect(usePhaseStore.getState().phaseTagIds).toEqual([1]);
    expect(usePhaseStore.getState().links).toEqual([{ childId: 30, parentId: 11 }]);
  });
});

describe("recording the last observed position", () => {
  it("writes at most once every five seconds, because it is called every frame", async () => {
    usePhaseStore.setState({
      open: [{ eventId: 11, tagId: 1, streamKey: "team:5", teamId: 5, startedAtMs: 0 }],
    });

    const { touch } = usePhaseStore.getState();
    touch(11, 1_000);
    touch(11, 2_000);
    touch(11, 5_999);
    expect(touchSession).toHaveBeenCalledTimes(1);

    touch(11, 6_000);
    expect(touchSession).toHaveBeenCalledTimes(2);
    expect(touchSession).toHaveBeenLastCalledWith(11, 6_000);
  });
});

describe("turning a tag back into a one-press tag", () => {
  it("refuses while that tag's phase is running, and says why", async () => {
    // What the owner hit: pressing the taxonomy control mid-passage ended the
    // phase, and the bar they were watching became a three-pixel event that read
    // as "it disappeared". Refusing is the only answer that cannot look like loss.
    usePhaseStore.setState({
      phaseTagIds: [1],
      open: [{ eventId: 11, tagId: 1, streamKey: "team:5", teamId: 5, startedAtMs: 10_000 }],
    });

    await usePhaseStore.getState().setPhaseTag(1, false);

    expect(phasesQuery.setTagPhase).not.toHaveBeenCalled();
    expect(usePhaseStore.getState().phaseTagIds).toEqual([1]);
    expect(usePhaseStore.getState().error).toMatch(/stop that phase/i);
  });

  it("unmarks a tag that is not running", async () => {
    usePhaseStore.setState({ phaseTagIds: [1], open: [] });

    await usePhaseStore.getState().setPhaseTag(1, false);

    expect(phasesQuery.setTagPhase).toHaveBeenCalledWith(1, false);
    expect(usePhaseStore.getState().phaseTagIds).toEqual([]);
  });
});
