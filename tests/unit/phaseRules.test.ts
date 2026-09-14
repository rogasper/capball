import { describe, expect, it } from "vitest";
import {
  closureReason,
  describeClosure,
  interruptedEndMs,
  NO_TEAM_STREAM,
  type OpenPhase,
  type ParentLink,
  parentForMoment,
  parentsOfChild,
  resolveWindow,
  streamKeyOf,
  teamIdOfStream,
  wouldCycle,
} from "@/lib/phases/rules";

/**
 * The phase rules (FR-55), tested without a database, a video or a React tree.
 *
 * These are the decisions a phase turns on: which stream it runs in and so what
 * it closes, what an action belongs to, whether a link would cycle, and what
 * window a clip really covers once padding stops being stored (D41).
 */

const phase = (eventId: number, teamId: number | null, startedAtMs = 0): OpenPhase => ({
  eventId,
  tagId: eventId * 10,
  streamKey: streamKeyOf(teamId),
  teamId,
  startedAtMs,
});

describe("phase streams", () => {
  it("keys a stream by its team, and gives no team a stream of its own", () => {
    expect(streamKeyOf(7)).toBe("team:7");
    expect(streamKeyOf(null)).toBe(NO_TEAM_STREAM);
    expect(teamIdOfStream("team:7")).toBe(7);
    expect(teamIdOfStream(NO_TEAM_STREAM)).toBeNull();
  });
});

describe("how a phase ended", () => {
  it("reports an interrupted phase as empty when no position was ever recorded", () => {
    // Without this, a phase left open would claim a duration nobody observed.
    expect(closureReason("exit", false)).toBe("empty");
    expect(closureReason("exit", true)).toBe("exit");
  });

  it("passes the reasons that are their own explanation straight through", () => {
    expect(closureReason("user", true)).toBe("user");
    expect(closureReason("new-phase", true)).toBe("new-phase");
    expect(closureReason("video-end", true)).toBe("video-end");
  });

  it("closes an interrupted phase at what was seen, never earlier than its start", () => {
    expect(interruptedEndMs(10_000, 42_000)).toBe(42_000);
    expect(interruptedEndMs(10_000, null)).toBe(10_000);
    expect(interruptedEndMs(10_000, 4_000)).toBe(10_000);
  });

  it("tells an open phase apart from an event that was never a phase run", () => {
    // Found in the owner's real library: four Build Up moments were captured
    // before the tag was marked as a phase, had no session row, and were labelled
    // "recording" for ever — a record claiming something that never happened.
    expect(describeClosure(null)).toBe("recording");
    expect(describeClosure(undefined)).toBe("not a phase run");
  });

  it("says in words whether the user or the app stopped it", () => {
    const worded = [
      describeClosure("user"),
      describeClosure("new-phase"),
      describeClosure("video-end"),
      describeClosure("exit"),
      describeClosure("empty"),
      describeClosure(null),
      describeClosure(undefined),
    ];
    // Every case is distinct and none is empty: the difference FR-55.4 requires
    // be visible cannot be a colour, so it is a sentence.
    expect(new Set(worded).size).toBe(worded.length);
    expect(worded.every((text) => text.length > 0)).toBe(true);
  });
});

describe("what an action belongs to (FR-55.3)", () => {
  it("attaches to its own team's open phase", () => {
    const open = [phase(1, 5), phase(2, 9)];
    expect(parentForMoment(9, open)).toEqual({ kind: "attach", parentId: 2 });
  });

  it("attaches to the only open phase even when the team differs", () => {
    // The possession case: the defending side's press inside the attack's phase.
    expect(parentForMoment(9, [phase(1, 5)])).toEqual({ kind: "attach", parentId: 1 });
  });

  it("refuses to guess between two phases of other teams", () => {
    expect(parentForMoment(9, [phase(1, 5), phase(2, 7)])).toEqual({
      kind: "none",
      reason: "ambiguous",
    });
  });

  it("records a standalone moment when nothing is open", () => {
    expect(parentForMoment(null, [])).toEqual({ kind: "none", reason: "no-open-phase" });
  });
});

describe("a link that would cycle", () => {
  const links: ParentLink[] = [
    { childId: 2, parentId: 1 },
    { childId: 3, parentId: 2 },
  ];

  it("refuses a phase inside itself", () => {
    expect(wouldCycle(links, 1, 1)).toBe(true);
  });

  it("refuses a descendant as an ancestor", () => {
    // 3 is inside 2, so 2 cannot be inside 3.
    expect(wouldCycle(links, 1, 3)).toBe(true);
  });

  it("allows a link that adds nothing to the chain", () => {
    expect(wouldCycle(links, 4, 1)).toBe(false);
  });

  it("is not confused by a shared ancestor", () => {
    const diamond: ParentLink[] = [
      { childId: 2, parentId: 1 },
      { childId: 3, parentId: 1 },
    ];
    expect(wouldCycle(diamond, 3, 2)).toBe(false);
  });
});

describe("the window an event resolves to (D41)", () => {
  const roll = { preRollMs: 8_000, postRollMs: 12_000 };

  it("gives a phase its own span, and never pads it", () => {
    expect(
      resolveWindow(
        { startMs: 60_000, endMs: 95_000, anchorMs: 60_000, kind: "phase" },
        roll,
        861_737,
      ),
    ).toEqual({ startMs: 60_000, endMs: 95_000, source: "stored" });
  });

  it("does not pad even a zero-length phase", () => {
    // A phase stopped the instant it started has no duration to export; inventing
    // padding for it would be the padding this whole model exists to remove.
    expect(
      resolveWindow(
        { startMs: 60_000, endMs: 60_000, anchorMs: 60_000, kind: "phase" },
        roll,
        861_737,
      ),
    ).toEqual({ startMs: 60_000, endMs: 60_000, source: "stored" });
  });

  it("keeps the range a moment was captured or trimmed with", () => {
    expect(
      resolveWindow(
        { startMs: 52_000, endMs: 72_000, anchorMs: 60_000, kind: "event" },
        roll,
        861_737,
      ),
    ).toEqual({ startMs: 52_000, endMs: 72_000, source: "stored" });
  });

  it("resolves an action — a bare instant — from the roll settings", () => {
    expect(
      resolveWindow(
        { startMs: 60_000, endMs: 60_000, anchorMs: 60_000, kind: "event" },
        roll,
        861_737,
      ),
    ).toEqual({ startMs: 52_000, endMs: 72_000, source: "padding" });
  });

  it("clamps the resolved window to the video", () => {
    expect(
      resolveWindow({ startMs: 1_000, endMs: 1_000, anchorMs: 1_000, kind: "event" }, roll, 5_000),
    ).toEqual({ startMs: 0, endMs: 5_000, source: "padding" });
  });
});

describe("the phases an action is in", () => {
  const links: ParentLink[] = [
    { childId: 5, parentId: 1 },
    { childId: 5, parentId: 2 },
    { childId: 6, parentId: 1 },
  ];

  it("lists both phases of an action with two parents", () => {
    expect(parentsOfChild(links, 5)).toEqual([1, 2]);
    expect(parentsOfChild(links, 6)).toEqual([1]);
    expect(parentsOfChild(links, 7)).toEqual([]);
  });
});
