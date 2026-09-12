import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarkingPanel } from "@/features/pitch/MarkingPanel";
import { useAnnotationStore } from "@/stores/annotationStore";
import { useCalibrationStore } from "@/stores/calibrationStore";
import { useEventStore } from "@/stores/eventStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { usePositionStore } from "@/stores/positionStore";
import { useSquadStore } from "@/stores/squadStore";

/**
 * The marking panel's honesty states (FR-30.1, FR-30.5, NFR-26).
 *
 * An uncalibrated video must explain itself rather than letting the user mark
 * points that have nowhere to land, and a calibration that covers only part of
 * the pitch must say so before a position is placed, not after.
 */

vi.mock("@/lib/ipc/database", () => ({
  execute: vi.fn().mockResolvedValue(undefined),
  select: vi.fn().mockResolvedValue([]),
}));

const event = {
  id: 7,
  videoId: 1,
  anchorMs: 85_701,
  startMs: 77_701,
  endMs: 97_701,
  notes: null,
  tagId: 1,
  tagName: "Shot",
  tagColor: "#4C8DFF",
  categoryName: "ATTACK",
  teamId: 1,
  teamName: "Manchester United",
  playerId: null,
  playerName: null,
};

/** The four corners of one penalty area: about 9% of a 105 by 68 pitch. */
const tightReference = [
  { feature: "left-pa-front-top", imageU: 0.2, imageV: 0.3, xM: -36, yM: -20.16 },
  { feature: "left-pa-front-bottom", imageU: 0.2, imageV: 0.7, xM: -36, yM: 20.16 },
  { feature: "left-pa-goal-line-top", imageU: 0.05, imageV: 0.35, xM: -52.5, yM: -20.16 },
  { feature: "left-pa-goal-line-bottom", imageU: 0.05, imageV: 0.65, xM: -52.5, yM: 20.16 },
];

beforeEach(() => {
  useEventStore.setState({ events: [event], lastCapturedId: null, undoStack: [], error: null });
  useLibraryStore.setState({
    currentMatch: {
      id: 1,
      homeTeamId: 1,
      awayTeamId: 2,
      competition: null,
      season: null,
      kickoffAt: null,
      venue: null,
      notes: null,
      createdAt: 0,
      updatedAt: 0,
    },
    activeVideoId: 1,
  });
  useSquadStore.setState({
    teams: {},
    players: {},
    error: null,
  });
  usePositionStore.setState({
    eventId: null,
    positions: [],
    marking: false,
    target: null,
    error: null,
    notice: null,
  });
  useCalibrationStore.setState({
    videoId: 1,
    calibrations: [],
    picks: [],
    fromMs: 0,
    pitchLengthM: 105,
    pitchWidthM: 68,
    pendingFeature: null,
    editingId: null,
    error: null,
  });
  useAnnotationStore.setState({ eventId: null, annotations: [], error: null, selectedId: null });
});

describe("MarkingPanel", () => {
  it("asks for an event before it asks for anything else", () => {
    render(<MarkingPanel />);
    expect(screen.getByText(/select an event first/i)).toBeInTheDocument();
  });

  it("explains that an uncalibrated video cannot take positions, and disables marking", () => {
    useAnnotationStore.setState({ eventId: 7 });

    render(<MarkingPanel />);

    expect(screen.getByText(/not calibrated/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mark positions/i })).toBeDisabled();
  });

  it("says how much of the pitch the calibration covers", () => {
    useAnnotationStore.setState({ eventId: 7 });
    useCalibrationStore.setState({
      calibrations: [
        {
          id: 1,
          videoId: 1,
          fromMs: 0,
          pitchLengthM: 105,
          pitchWidthM: 68,
          rmsErrorPx: 1.4,
          points: tightReference,
        },
      ],
    });

    render(<MarkingPanel />);

    // Roughly a penalty area on a full pitch: the warning has to be plain.
    expect(screen.getByText(/only about 9% of the pitch/i)).toBeInTheDocument();
    expect(screen.getByText(/unreliable/i)).toBeInTheDocument();
  });

  it("offers the pitch view, and says when the moment has nothing on it", () => {
    useAnnotationStore.setState({ eventId: 7 });

    render(<MarkingPanel />);

    expect(screen.getByText(/no positions on this moment/i)).toBeInTheDocument();
  });
});
