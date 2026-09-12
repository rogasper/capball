import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventRow } from "@/lib/db/queries/events";
import type { JobEvent } from "@/lib/ipc";

/**
 * Export orchestration.
 *
 * The batch is sequenced here rather than in Rust, so this is where the order of
 * clips, the padding, the conflict refusal and the join step are pinned down.
 */

const startExport = vi.fn();
const startConcat = vi.fn();
const fileStatus = vi.fn();
const cancelJob = vi.fn();
const awaitJob = vi.fn();

vi.mock("@/lib/ipc", () => ({
  ipc: {
    startExport: (...args: unknown[]) => startExport(...args),
    startConcat: (...args: unknown[]) => startConcat(...args),
    fileStatus: (...args: unknown[]) => fileStatus(...args),
    cancelJob: (...args: unknown[]) => cancelJob(...args),
    defaultExportDir: vi.fn().mockResolvedValue("/Movies/capball"),
    assetUrl: (path: string) => `asset://${path}`,
  },
}));

vi.mock("@/lib/jobs/jobEvents", () => ({
  awaitJob: (...args: unknown[]) => awaitJob(...args),
}));

async function loadStore() {
  vi.resetModules();
  const settings = await import("@/stores/settingsStore");
  // Preferences live in the settings store; the export store only runs.
  settings.useSettingsStore.setState({
    exportDestination: "/Movies/capball",
    exportTemplate: "{match}_{tag}_{time}",
    exportMode: "fast",
    exportExtraBeforeMs: 0,
    exportExtraAfterMs: 0,
    exportConcatenate: false,
  });

  return {
    ...(await import("@/stores/exportStore")),
    useSettingsStore: settings.useSettingsStore,
  };
}

function row(id: number, tagName: string, anchorMs: number): EventRow {
  return {
    id,
    videoId: 1,
    anchorMs,
    startMs: anchorMs - 8_000,
    endMs: anchorMs + 12_000,
    notes: null,
    tagId: 1,
    tagName,
    tagColor: "#4C8DFF",
    categoryName: "ATTACK",
    teamId: null,
    teamName: null,
    playerId: null,
    playerName: null,
  };
}

const context = {
  homeTeam: "Manchester United",
  awayTeam: "Sabah",
  competition: "Champions League",
};

const events = [row(2, "Mid Block", 103_062), row(1, "Shot", 85_701)];

const runInput = {
  events,
  context,
  durationMs: 861_737,
  sourcePath: "/matches/mu_vs_sabah.mp4",
};

function done(jobId: string): JobEvent {
  return {
    jobId,
    kind: "export",
    state: "done",
    outTimeMs: 20_000,
    totalMs: 20_000,
    message: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fileStatus.mockResolvedValue({ exists: false, sizeBytes: null });
  startExport.mockImplementation((_input: string, output: string) =>
    Promise.resolve({ jobId: `job-${output}`, output, reused: false }),
  );
  startConcat.mockImplementation((_inputs: string[], output: string) =>
    Promise.resolve({ jobId: "concat-job", output, reused: false }),
  );
  awaitJob.mockImplementation((jobId: string) => Promise.resolve(done(jobId)));
});

describe("export batch", () => {
  it("writes one clip per event, in chronological order, with templated names", async () => {
    const { useExportStore } = await loadStore();

    await useExportStore.getState().run(runInput);

    expect(startExport.mock.calls.map((call) => call[1])).toEqual([
      "/Movies/capball/Manchester-United-vs-Sabah_Shot_01-25-701.mp4",
      "/Movies/capball/Manchester-United-vs-Sabah_Mid-Block_01-43-062.mp4",
    ]);
    expect(useExportStore.getState().phase).toBe("done");
    expect(useExportStore.getState().exported).toHaveLength(2);
  });

  it("cuts the range the event carries, without padding by default", async () => {
    const { useExportStore } = await loadStore();

    await useExportStore.getState().run(runInput);

    expect(startExport.mock.calls[0]?.slice(2)).toEqual([77_701, 97_701, "fast"]);
  });

  it("adds padding on request", async () => {
    const { useExportStore, useSettingsStore } = await loadStore();
    useSettingsStore.setState({ exportExtraBeforeMs: 2_000, exportExtraAfterMs: 3_000 });

    await useExportStore.getState().run(runInput);

    expect(startExport.mock.calls[0]?.slice(2)).toEqual([75_701, 100_701, "fast"]);
  });

  it("refuses before writing anything when a file is already there", async () => {
    fileStatus.mockResolvedValue({ exists: true, sizeBytes: 10 });
    const { useExportStore } = await loadStore();

    await useExportStore.getState().run(runInput);

    expect(startExport).not.toHaveBeenCalled();
    expect(useExportStore.getState().phase).toBe("error");
    expect(useExportStore.getState().problems[0]).toMatch(/already exists/);
  });

  it("refuses a template that names two events the same way", async () => {
    const { useExportStore, useSettingsStore } = await loadStore();
    useSettingsStore.setState({ exportTemplate: "{tag}" });

    // Two events of the same tag: the template cannot tell them apart.
    await useExportStore.getState().run({
      ...runInput,
      events: [row(1, "Shot", 85_701), row(3, "Shot", 300_000)],
    });

    expect(startExport).not.toHaveBeenCalled();
    expect(useExportStore.getState().problems[0]).toMatch(/twice/);
  });

  it("joins the clips afterwards, in the same order, when asked", async () => {
    const { useExportStore, useSettingsStore } = await loadStore();
    useSettingsStore.setState({ exportConcatenate: true });

    await useExportStore.getState().run(runInput);

    expect(startConcat).toHaveBeenCalledTimes(1);
    const [inputs, output, totalMs] = startConcat.mock.calls[0] ?? [];
    expect(inputs).toEqual([
      "/Movies/capball/Manchester-United-vs-Sabah_Shot_01-25-701.mp4",
      "/Movies/capball/Manchester-United-vs-Sabah_Mid-Block_01-43-062.mp4",
    ]);
    expect(output).toBe("/Movies/capball/Manchester-United-vs-Sabah_all_01-25-701.mp4");
    expect(totalMs).toBe(40_000);
    expect(useExportStore.getState().phase).toBe("done");
  });

  it("stops the batch when one clip fails, and says which", async () => {
    awaitJob.mockResolvedValueOnce(done("first")).mockResolvedValueOnce({
      jobId: "second",
      kind: "export",
      state: "failed",
      outTimeMs: 0,
      totalMs: 20_000,
      message: "ffmpeg said no",
    });
    const { useExportStore } = await loadStore();

    await useExportStore.getState().run(runInput);

    expect(startExport).toHaveBeenCalledTimes(2);
    expect(useExportStore.getState().phase).toBe("error");
    expect(useExportStore.getState().error).toMatch(/ffmpeg said no/);
    expect(useExportStore.getState().concatenated).toBeNull();
  });

  it("treats a cancelled clip as a stop, not a failure", async () => {
    awaitJob.mockResolvedValueOnce({
      jobId: "first",
      kind: "export",
      state: "cancelled",
      outTimeMs: 0,
      totalMs: 20_000,
      message: null,
    });
    const { useExportStore } = await loadStore();

    await useExportStore.getState().run(runInput);

    expect(useExportStore.getState().phase).toBe("idle");
    expect(useExportStore.getState().error).toBeNull();
    expect(startExport).toHaveBeenCalledTimes(1);
  });

  it("asks for a folder and a video before it starts", async () => {
    const { useExportStore, useSettingsStore } = await loadStore();

    await useExportStore.getState().run({ ...runInput, sourcePath: null });
    expect(useExportStore.getState().error).toMatch(/import a video/i);

    // No destination yet, which is the state before the default is filled in.
    useExportStore.setState({ error: null });
    useSettingsStore.setState({ exportDestination: null });
    await useExportStore.getState().run({ ...runInput, sourcePath: "/x.mp4" });
    expect(useExportStore.getState().error).toMatch(/folder/i);

    useExportStore.setState({ error: null });
    useSettingsStore.setState({ exportDestination: "/Movies/capball" });
    await useExportStore.getState().run({ ...runInput, events: [], sourcePath: "/x.mp4" });
    expect(useExportStore.getState().error).toMatch(/at least one event/i);
  });
});
