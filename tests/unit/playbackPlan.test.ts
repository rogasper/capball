import { describe, expect, it } from "vitest";
import type { MediaProbe } from "@/lib/ipc";
import { planPlayback } from "@/lib/media/playbackPlan";

function probe(overrides: Partial<MediaProbe>): MediaProbe {
  return {
    path: "/matches/sample.mkv",
    sizeBytes: 2_061_017_150,
    container: "matroska,webm",
    durationMs: 540_000,
    width: 1920,
    height: 1080,
    fpsNum: 30,
    fpsDen: 1,
    videoCodec: "h264",
    audioCodec: "aac",
    faststart: null,
    ...overrides,
  };
}

describe("planPlayback", () => {
  it("plays a supported container and codecs directly", () => {
    const plan = planPlayback(
      probe({ container: "mov,mp4,m4a,3gp,3g2,mj2", videoCodec: "h264", audioCodec: "aac" }),
    );
    expect(plan.kind).toBe("direct");
  });

  it("accepts HEVC in MP4 and a silent video", () => {
    expect(
      planPlayback(
        probe({ container: "mov,mp4,m4a,3gp,3g2,mj2", videoCodec: "hevc", audioCodec: null }),
      ).kind,
    ).toBe("direct");
  });

  it("remuxes a container the player cannot open when the codecs can be copied", () => {
    const plan = planPlayback(probe({ container: "matroska,webm" }));
    expect(plan).toMatchObject({ kind: "prepare", mode: "remux" });
  });

  it("transcodes when the video codec cannot be copied", () => {
    const plan = planPlayback(probe({ videoCodec: "vp9", audioCodec: "aac" }));
    expect(plan).toMatchObject({ kind: "prepare", mode: "transcode" });
  });

  it("transcodes when the audio codec cannot be copied", () => {
    const plan = planPlayback(probe({ videoCodec: "h264", audioCodec: "flac" }));
    expect(plan).toMatchObject({ kind: "prepare", mode: "transcode" });
  });

  it("transcodes when only the container would have been a problem", () => {
    const plan = planPlayback(
      probe({ container: "matroska,webm", videoCodec: "vp9", audioCodec: "opus" }),
    );
    expect(plan).toMatchObject({ kind: "prepare", mode: "transcode" });
  });

  it("explains itself, so the UI never has to guess", () => {
    const plan = planPlayback(probe({ videoCodec: "vp9", audioCodec: "opus" }));
    if (plan.kind !== "prepare") throw new Error("expected a prepare plan");
    expect(plan.reason).toContain("vp9");
    expect(plan.reason).toContain("opus");
  });

  it("prepares a playable file whose index sits at the end, because seeking would be slow", () => {
    const plan = planPlayback(
      probe({
        container: "mov,mp4,m4a,3gp,3g2,mj2",
        videoCodec: "h264",
        audioCodec: "aac",
        faststart: false,
      }),
    );
    expect(plan).toMatchObject({ kind: "prepare", mode: "remux" });
    if (plan.kind !== "prepare") throw new Error("expected a prepare plan");
    expect(plan.reason).toMatch(/index/i);
  });

  it("plays directly when the index is at the front", () => {
    expect(planPlayback(probe({ faststart: true })).kind).toBe("prepare");
    expect(
      planPlayback(
        probe({
          container: "mov,mp4,m4a,3gp,3g2,mj2",
          faststart: true,
        }),
      ).kind,
    ).toBe("direct");
  });

  it("ignores the index question for containers that have no index to move", () => {
    // faststart is null for Matroska, which must not be read as "false".
    const plan = planPlayback(probe({ container: "matroska,webm", faststart: null }));
    expect(plan).toMatchObject({ kind: "prepare", mode: "remux" });
  });

  it("plays a real 1080p60 match recording directly", () => {
    // Values taken from a real 522 MB match file: MP4, H.264, AAC, 60000/1001 fps.
    const plan = planPlayback(
      probe({
        container: "mov,mp4,m4a,3gp,3g2,mj2",
        videoCodec: "h264",
        audioCodec: "aac",
        width: 1920,
        height: 1080,
        fpsNum: 60_000,
        fpsDen: 1001,
        durationMs: 861_737,
        sizeBytes: 538_023_704,
      }),
    );
    expect(plan.kind).toBe("direct");
  });
});
