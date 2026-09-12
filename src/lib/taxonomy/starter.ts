/**
 * The starter taxonomy (FR-4.3, PRD Appendix A).
 *
 * A standard football-analysis vocabulary so tagging works on first run. It is
 * ordinary data — fully editable and deletable — not a fixed schema.
 *
 * Nine tags carry a default key so one-key capture works immediately; the rest
 * are unbound and left for the user to assign.
 */

export type StarterTag = {
  name: string;
  shortcutKey?: string;
};

export type StarterCategory = {
  name: string;
  color: string;
  tags: StarterTag[];
};

export const STARTER_TAXONOMY: StarterCategory[] = [
  {
    name: "ATTACK",
    color: "#4C8DFF",
    tags: [
      { name: "Build Up", shortcutKey: "2" },
      { name: "Progression" },
      { name: "Final Third", shortcutKey: "8" },
      { name: "Chance Creation", shortcutKey: "4" },
      { name: "Shot", shortcutKey: "5" },
    ],
  },
  {
    name: "DEFENSE",
    color: "#34D399",
    tags: [
      { name: "High Press", shortcutKey: "1" },
      { name: "Mid Block", shortcutKey: "7" },
      { name: "Low Block" },
      { name: "Counter Press" },
      { name: "Defensive Error", shortcutKey: "6" },
    ],
  },
  {
    name: "TRANSITION",
    color: "#FBBF24",
    tags: [
      { name: "Counter Attack", shortcutKey: "3" },
      { name: "Recovery" },
      { name: "Set Piece", shortcutKey: "9" },
    ],
  },
];
