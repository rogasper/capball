import { create } from "zustand";
import type { ToolStatus } from "@/lib/ipc";

const DEFAULT_PRE_ROLL_MS = 8_000;
const DEFAULT_POST_ROLL_MS = 12_000;

type SettingsState = {
  preRollMs: number;
  postRollMs: number;
  tools: ToolStatus | null;
  setPreRollMs: (ms: number) => void;
  setPostRollMs: (ms: number) => void;
  setTools: (tools: ToolStatus) => void;
};

export const useSettingsStore = create<SettingsState>((set) => ({
  preRollMs: DEFAULT_PRE_ROLL_MS,
  postRollMs: DEFAULT_POST_ROLL_MS,
  tools: null,
  setPreRollMs: (preRollMs) => set({ preRollMs: Math.max(0, Math.round(preRollMs)) }),
  setPostRollMs: (postRollMs) => set({ postRollMs: Math.max(0, Math.round(postRollMs)) }),
  setTools: (tools) => set({ tools }),
}));
