import { create } from "zustand";

/**
 * Whether the magnified frame view is open, and what it is for.
 *
 * The video is shown at roughly 430 CSS px for a 1920-px picture, so a screen
 * pixel is worth more than four video pixels. That penalises every point the user
 * has to place — a calibration reference and a player's position alike — which is
 * why one magnified view serves both flows rather than each growing its own.
 *
 * The mode is explicit rather than inferred from which panel is showing, so the
 * two flows cannot fight over the same click.
 */

export type MagnifierMode = "calibration" | "position";

type MagnifierState = {
  mode: MagnifierMode | null;
  open: (mode: MagnifierMode) => void;
  close: () => void;
};

export const useMagnifierStore = create<MagnifierState>((set) => ({
  mode: null,
  open(mode) {
    set({ mode });
  },
  close() {
    set({ mode: null });
  },
}));
