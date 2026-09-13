import { describe, expect, it, vi } from "vitest";

// The policy's file work is Rust's; the description helpers are what is under
// test, so the IPC surface is stubbed out.
vi.mock("@/lib/ipc", () => ({ ipc: { pruneCache: vi.fn() } }));
vi.mock("@/lib/db/queries/videos", () => ({ listAllVideoPaths: vi.fn() }));

const { describeCacheReport, formatBytes } = await import("@/lib/media/cache");

/**
 * The cache policy's voice (NFR-22).
 *
 * The policy itself is Rust's file work and is tested there; what is checked
 * here is that the sentence a user reads is honest — in particular that "nothing
 * to remove" is not dressed up as a cleanup.
 */

describe("describeCacheReport", () => {
  it("says nothing was removed when the cache was tidy", () => {
    expect(describeCacheReport({ removedFiles: 0, freedBytes: 0 })).toMatch(/already tidy/i);
  });

  it("counts files and gives a human size", () => {
    const text = describeCacheReport({ removedFiles: 3, freedBytes: 5 * 1024 * 1024 });
    expect(text).toContain("3 files");
    expect(text).toContain("5.0 MB");
  });

  it("uses the singular for one file", () => {
    expect(describeCacheReport({ removedFiles: 1, freedBytes: 900 })).toContain("1 file,");
  });
});

describe("formatBytes", () => {
  it("steps through the units a person reads", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(1024 * 1024 * 3)).toBe("3.0 MB");
    expect(formatBytes(1024 * 1024 * 1024 * 2)).toBe("2.00 GB");
  });
});
