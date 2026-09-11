import { describe, expect, it } from "vitest";
import {
  clipRange,
  formatTimecode,
  frameDurationMs,
  parseTimecode,
  stepFrames,
} from "@/lib/time/timecode";

describe("formatTimecode", () => {
  it("formats sub-hour durations as MM:SS.mmm", () => {
    expect(formatTimecode(0)).toBe("00:00.000");
    expect(formatTimecode(5_000)).toBe("00:05.000");
    expect(formatTimecode(78_250)).toBe("01:18.250");
  });

  it("adds an hours field past an hour", () => {
    expect(formatTimecode(4_712_250)).toBe("1:18:32.250");
  });

  it("never renders a negative time", () => {
    expect(formatTimecode(-500)).toBe("00:00.000");
  });
});

describe("parseTimecode", () => {
  it("reads MM:SS and H:MM:SS", () => {
    expect(parseTimecode("78:32")).toBe(4_712_000);
    expect(parseTimecode("1:18:32.250")).toBe(4_712_250);
  });

  it("treats a short fraction as milliseconds", () => {
    expect(parseTimecode("00:01.5")).toBe(1_500);
  });

  it("rejects anything it cannot read confidently", () => {
    expect(parseTimecode("")).toBeNull();
    expect(parseTimecode("not a time")).toBeNull();
    expect(parseTimecode("1:99:00")).toBeNull();
    expect(parseTimecode("00:75")).toBeNull();
  });
});

describe("frameDurationMs", () => {
  it("derives the frame duration from a rational rate", () => {
    expect(frameDurationMs(30, 1)).toBeCloseTo(33.333, 2);
    expect(frameDurationMs(30_000, 1001)).toBeCloseTo(33.367, 2);
  });

  it("returns null when the rate is unknown", () => {
    expect(frameDurationMs(null, null)).toBeNull();
    expect(frameDurationMs(0, 1)).toBeNull();
  });
});

describe("clipRange", () => {
  it("surrounds the moment with pre-roll and post-roll", () => {
    expect(clipRange(10_000, 8_000, 12_000, 600_000)).toEqual({
      startMs: 2_000,
      endMs: 22_000,
    });
  });

  it("clamps to the start of the video", () => {
    expect(clipRange(3_000, 8_000, 12_000, 600_000)).toEqual({
      startMs: 0,
      endMs: 15_000,
    });
  });

  it("clamps to the end of the video", () => {
    expect(clipRange(595_000, 8_000, 12_000, 600_000)).toEqual({
      startMs: 587_000,
      endMs: 600_000,
    });
  });

  it("never produces an end before its start", () => {
    const range = clipRange(100, 0, 12_000, 5_000);
    expect(range.startMs).toBe(100);
    expect(range.endMs).toBe(5_000);
  });
});

describe("stepFrames", () => {
  it("advances by exactly one frame", () => {
    expect(stepFrames(1_000, 1, 30, 1, 10_000)).toBeCloseTo(1_033.33, 2);
  });

  it("stays inside the video", () => {
    expect(stepFrames(0, -1, 30, 1, 10_000)).toBe(0);
    expect(stepFrames(10_000, 1, 30, 1, 10_000)).toBe(10_000);
  });

  it("does nothing when the frame rate is unknown", () => {
    expect(stepFrames(1_000, 1, null, null, 10_000)).toBe(1_000);
  });
});
