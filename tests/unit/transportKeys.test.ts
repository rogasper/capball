import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTransportKeys } from "@/features/player/useTransportKeys";

/**
 * Transport keys, and the tab row (FR-2, NFR-9).
 *
 * Reported from the running app: seeking with the arrow keys while a tab had
 * focus **selected the next tab**, so the panel walked sideways during playback.
 * Radix activates tabs on arrow keys, and the transport was handling the same
 * keys. Inside the tab list the arrows belong to the tabs; everywhere else they
 * belong to the player.
 */

vi.mock("@/lib/playback", () => ({
  playback: {
    toggle: vi.fn(),
    nudge: vi.fn(),
    timeMs: 0,
    durationMs: 90_000,
  },
}));

vi.mock("@/stores/libraryStore", () => ({
  useLibraryStore: { getState: () => ({ probe: { fpsNum: 25, fpsDen: 1 } }) },
}));

const { playback } = await import("@/lib/playback");
const toggle = vi.mocked(playback.toggle);
const nudge = vi.mocked(playback.nudge);

/** A tab row, as Radix renders it, with a focused trigger inside. */
function tabRow(): HTMLElement {
  const list = document.createElement("div");
  list.setAttribute("role", "tablist");
  const tab = document.createElement("button");
  tab.setAttribute("role", "tab");
  list.append(tab);
  document.body.append(list);
  return tab;
}

beforeEach(() => {
  vi.clearAllMocks();
  renderHook(() => useTransportKeys(true));
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useTransportKeys", () => {
  it("seeks from anywhere outside the tab row", () => {
    fireKey(document.body, "ArrowRight");
    expect(nudge).toHaveBeenCalledWith(5_000);
  });

  it("plays and pauses with the space bar", () => {
    fireKey(document.body, "Space");
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("leaves the arrow keys to the tabs while the tab row has focus", () => {
    const tab = tabRow();
    fireKey(tab, "ArrowRight");

    // The tab row walks; the video must not seek, or a seek would also switch
    // the panel out from under the user.
    expect(nudge).not.toHaveBeenCalled();
  });

  it("still plays from inside the tab row: space is this app's primary key", () => {
    const tab = tabRow();
    fireKey(tab, "Space");
    expect(toggle).toHaveBeenCalledTimes(1);
  });
});

function fireKey(target: EventTarget, code: string): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true }));
}
