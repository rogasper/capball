import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobEvent } from "@/lib/ipc";

/**
 * The job bridge hands a caller the terminal event for one job id.
 *
 * The subtle case is timing: `startExport` returns an id, and only afterwards
 * does the caller await it, so events for a job nobody is listening to yet must
 * not be lost. They must also not be confused with the *result* — buffering a
 * progress event aborted a real batch export, which is what this guards.
 */

type Listener = (event: JobEvent) => void;
let emit: Listener | null = null;

vi.mock("@/lib/ipc", () => ({
  ipc: {
    onJobEvent: (handler: Listener) => {
      emit = handler;
      return Promise.resolve(() => {
        emit = null;
      });
    },
  },
}));

function event(overrides: Partial<JobEvent>): JobEvent {
  return {
    jobId: "export-1",
    kind: "export",
    state: "running",
    outTimeMs: 0,
    totalMs: 20_000,
    message: null,
    ...overrides,
  };
}

async function loadModule() {
  vi.resetModules();
  return import("@/lib/jobs/jobEvents");
}

/**
 * The listener is a module-level singleton that outlives one job, so scenarios
 * about events arriving "too early" only apply once something has subscribed.
 */
async function primeListener(mod: { awaitJob: (id: string) => Promise<JobEvent> }) {
  const warm = mod.awaitJob("export-warmup");
  emit?.(event({ jobId: "export-warmup", state: "done" }));
  await warm;
}

beforeEach(() => {
  emit = null;
});

describe("awaitJob", () => {
  it("resolves with the terminal event", async () => {
    const { awaitJob } = await loadModule();
    const waiting = awaitJob("export-1");

    emit?.(event({ state: "running", outTimeMs: 5_000 }));
    emit?.(event({ state: "done", outTimeMs: 20_000 }));

    await expect(waiting).resolves.toMatchObject({ state: "done" });
  });

  it("reports progress to the caller without treating it as the result", async () => {
    const mod = await loadModule();
    const seen: number[] = [];
    const waiting = mod.awaitJob("export-1", (progress) => seen.push(progress.outTimeMs));

    // Let the registration settle first. In practice FFmpeg takes seconds, so
    // progress never races the subscription the way it does in a test.
    await new Promise((resolve) => setTimeout(resolve, 0));

    emit?.(event({ state: "running", outTimeMs: 5_000 }));
    emit?.(event({ state: "running", outTimeMs: 10_000 }));
    emit?.(event({ state: "done" }));

    await waiting;
    expect(seen).toEqual([5_000, 10_000]);
  });

  it("keeps a terminal event that arrived before anyone awaited the job", async () => {
    const mod = await loadModule();
    await primeListener(mod);

    // The job finished while the caller was still on its way to awaiting it.
    emit?.(event({ state: "done" }));

    await expect(mod.awaitJob("export-1")).resolves.toMatchObject({ state: "done" });
  });

  it("does not mistake early progress for a finished job", async () => {
    const mod = await loadModule();
    await primeListener(mod);

    // This is the regression: a progress event arriving first used to be handed
    // back as the result, so the sequencer saw "not done" and gave up.
    emit?.(event({ state: "running", outTimeMs: 3_000 }));
    const waiting = mod.awaitJob("export-1");

    const settled = vi.fn();
    void waiting.then(settled);
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    emit?.(event({ state: "done" }));
    await expect(waiting).resolves.toMatchObject({ state: "done" });
  });

  it("passes a failure through with its message", async () => {
    const { awaitJob } = await loadModule();
    const waiting = awaitJob("export-1");

    emit?.(event({ state: "failed", message: "ffmpeg said no" }));

    await expect(waiting).resolves.toMatchObject({
      state: "failed",
      message: "ffmpeg said no",
    });
  });

  it("keeps jobs apart", async () => {
    const { awaitJob } = await loadModule();
    const first = awaitJob("export-1");
    const second = awaitJob("export-2");

    emit?.(event({ jobId: "export-2", state: "done", outTimeMs: 9_000 }));
    emit?.(event({ jobId: "export-1", state: "failed", message: "nope" }));

    await expect(first).resolves.toMatchObject({ state: "failed" });
    await expect(second).resolves.toMatchObject({ state: "done" });
  });
});
