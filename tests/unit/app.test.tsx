import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import App from "@/App";

// The IPC layer is the only module that talks to Tauri, so mocking it is enough
// to render the real UI in a plain DOM.
vi.mock("@/lib/ipc", () => ({
  ipc: {
    checkMediaTools: vi.fn().mockResolvedValue({
      ffmpeg: true,
      ffprobe: true,
      ffmpegVersion: "ffmpeg version test",
    }),
    onJobEvent: vi.fn().mockResolvedValue(() => {}),
    pickVideoFile: vi.fn().mockResolvedValue(null),
    registerAssetPath: vi.fn().mockResolvedValue(undefined),
    fileStatus: vi.fn(),
    probeMedia: vi.fn(),
    startMediaJob: vi.fn(),
    cancelJob: vi.fn(),
    assetUrl: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
  },
}));

describe("App", () => {
  it("names the product and offers the import action", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "capball" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /import a match video/i })).toBeEnabled();
  });

  it("tells the user FFmpeg is required when it is missing", async () => {
    const { ipc } = await import("@/lib/ipc");
    vi.mocked(ipc.checkMediaTools).mockResolvedValueOnce({
      ffmpeg: false,
      ffprobe: false,
      ffmpegVersion: null,
    });

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/ffmpeg was not found/i);
  });
});
