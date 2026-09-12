import { beforeEach, describe, expect, it, vi } from "vitest";

// The queue only talks to this one command, so a mocked IPC keeps the real
// scheduling logic under test without FFmpeg or a running app.
vi.mock("@/lib/ipc", () => ({
  ipc: {
    extractThumbnail: vi.fn(),
    assetUrl: (path: string) => `asset://${path}`,
  },
}));

type Deferred = {
  promise: Promise<string>;
  resolve: (value: string) => void;
  reject: (error: unknown) => void;
};

function deferred(): Deferred {
  let resolve!: (value: string) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function loadModule() {
  vi.resetModules();
  const module = await import("@/lib/media/thumbnails");
  const { ipc } = await import("@/lib/ipc");
  return { module, extract: vi.mocked(ipc.extractThumbnail) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("thumbnail queue", () => {
  it("asks for a moment once, however many times it is requested", async () => {
    const { module, extract } = await loadModule();
    const request = deferred();
    extract.mockReturnValueOnce(request.promise);

    const first = module.requestThumbnail("/match.mp4", 1_000);
    const second = module.requestThumbnail("/match.mp4", 1_000);

    expect(second).toBe(first);
    expect(extract).toHaveBeenCalledTimes(1);

    request.resolve("/cache/a.jpg");
    await expect(first).resolves.toBe("asset:///cache/a.jpg");
  });

  it("renders a different moment separately", async () => {
    const { module, extract } = await loadModule();
    extract.mockResolvedValue("/cache/x.jpg");

    await module.requestThumbnail("/match.mp4", 1_000);
    await module.requestThumbnail("/match.mp4", 2_000);

    expect(extract).toHaveBeenCalledTimes(2);
  });

  it("never runs more than two renders at once", async () => {
    const { module, extract } = await loadModule();
    const slots = [deferred(), deferred(), deferred(), deferred()];
    let next = 0;
    extract.mockImplementation(() => slots[next++]?.promise ?? Promise.resolve("/cache/x.jpg"));

    const requests = [1, 2, 3, 4].map((at) => module.requestThumbnail("/match.mp4", at * 1_000));
    await vi.waitFor(() => expect(extract).toHaveBeenCalledTimes(2));

    // A slot only frees up when a render finishes.
    slots[0]?.resolve("/cache/1.jpg");
    await vi.waitFor(() => expect(extract).toHaveBeenCalledTimes(3));

    slots[1]?.resolve("/cache/2.jpg");
    await vi.waitFor(() => expect(extract).toHaveBeenCalledTimes(4));

    slots[2]?.resolve("/cache/3.jpg");
    slots[3]?.resolve("/cache/4.jpg");
    await Promise.all(requests);
  });

  it("lets what the user is looking at jump ahead of the background fill", async () => {
    const { module, extract } = await loadModule();
    const slots = [deferred(), deferred(), deferred(), deferred()];
    let next = 0;
    extract.mockImplementation(() => slots[next++]?.promise ?? Promise.resolve("/cache/x.jpg"));

    // Two slots taken, so the next two wait in the queue.
    module.requestThumbnail("/match.mp4", 1_000);
    module.requestThumbnail("/match.mp4", 2_000);
    module.requestThumbnail("/match.mp4", 3_000, module.BACKGROUND);
    const onDemand = module.requestThumbnail("/match.mp4", 4_000, module.ON_DEMAND);

    slots[0]?.resolve("/cache/1.jpg");
    await vi.waitFor(() => expect(extract).toHaveBeenCalledTimes(3));

    // The on-demand request went first, ahead of the earlier background one.
    expect(extract).toHaveBeenNthCalledWith(3, "/match.mp4", 4_000);

    slots[1]?.resolve("/cache/2.jpg");
    slots[2]?.resolve("/cache/4.jpg");
    await onDemand;
    await vi.waitFor(() => expect(extract).toHaveBeenCalledTimes(4));
    slots[3]?.resolve("/cache/3.jpg");
  });

  it("does not remember a failure, so a later attempt can retry", async () => {
    const { module, extract } = await loadModule();
    extract.mockRejectedValueOnce(new Error("ffmpeg said no"));
    extract.mockResolvedValue("/cache/retry.jpg");

    await expect(module.requestThumbnail("/match.mp4", 1_000)).rejects.toThrow(/ffmpeg said no/);
    await expect(module.requestThumbnail("/match.mp4", 1_000)).resolves.toBe(
      "asset:///cache/retry.jpg",
    );
    expect(extract).toHaveBeenCalledTimes(2);
  });
});
