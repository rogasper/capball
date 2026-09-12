import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import App from "@/App";

// The IPC layer is the only module that talks to Tauri, and the database bridge
// is the only module that loads the SQL plugin, so mocking those two is enough
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

vi.mock("@/lib/ipc/database", () => ({
  execute: vi.fn().mockResolvedValue(undefined),
  select: vi.fn().mockResolvedValue([]),
}));

describe("App", () => {
  it("names the product and shows an empty library", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "capball" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Matches" })).toBeInTheDocument();
    expect(await screen.findByText(/no matches yet/i)).toBeInTheDocument();
  });

  it("offers both the match and tag panels", async () => {
    render(<App />);

    expect(await screen.findByRole("tab", { name: "Match" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Tags" })).toBeInTheDocument();
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
