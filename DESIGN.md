---
name: design-system-capball
description: Implementation-ready design system for capball, a local-first desktop football analysis tool with a dark, dense, keyboard-first, video-centric interface and user-defined tag colours.
---

# capball Design System

## Mission

Make match analysis feel like watching, not like data entry. The interface exists to keep the user's eyes on the footage and their hands on the keyboard: capture is one keystroke, chrome recedes, and the timeline is the map of everything they noticed. This is a desktop tool for focused work, not a marketing surface.

## Brand

- Product / brand: capball
- Audience: football fans who analyse matches for pleasure; secondarily, grassroots coaches reviewing their own recordings
- Product surface: desktop application only (Tauri, macOS first). No marketing site, no mobile, no web app in R1.
- Personality: calm, precise, football-literate — a tool a coach would trust, not a social app.

## Style Foundations

### Visual style

Dark, neutral, dense, low-chrome. Near-neutral greys so footage colours read true — never a tinted overlay over video. The video and the timeline are the largest and calmest surfaces; everything else stays quiet until needed.

### Colour tokens

Semantic tokens only — components must never use raw hex.

| Token | Value | Role |
| --- | --- | --- |
| `--bg-base` | `#0B0D0F` | App background, area behind the video |
| `--bg-surface` | `#14171A` | Panels, sidebar, event list |
| `--bg-raised` | `#1C2024` | Popovers, dialogs, hovered or selected rows |
| `--border-subtle` | `#2A2F35` | Dividers, panel edges |
| `--border-strong` | `#3A424B` | Focused inputs, selected rows |
| `--text-primary` | `#E8EAED` | Primary text |
| `--text-secondary` | `#9AA3AD` | Labels, metadata |
| `--text-muted` | `#6B747E` | Disabled text, placeholders |
| `--accent` | `#4C8DFF` | Primary actions, focus ring, active selection |
| `--accent-hover` | `#6BA1FF` | Hover state for accent |
| `--success` | `#34D399` | Completed jobs |
| `--warning` | `#FBBF24` | Warnings, degraded mode |
| `--danger` | `#F87171` | Destructive actions, errors |

**Tag colours are user-defined.** Ship a default palette of eight hues that all pass contrast on `--bg-surface`, and never let colour be the only identifier (see Accessibility).

### Typography

- UI: **Inter** (variable), fallback to system UI.
- Timecodes and numeric data: **JetBrains Mono** or `ui-monospace`. Every timecode **must** use tabular numerals (`font-variant-numeric: tabular-nums`) so digits do not shift while time runs.

| Token | Size | Weight | Line height | Use |
| --- | --- | --- | --- | --- |
| `text-caption` | 11px | 500 | 1.4 | Marker labels, badges |
| `text-label` | 12px | 500 | 1.4 | Field labels, tag chips |
| `text-body` | 13px | 400 | 1.5 | Default UI text |
| `text-body-lg` | 14px | 400 | 1.5 | Event rows, notes |
| `text-title` | 16px | 600 | 1.4 | Panel titles |
| `text-heading` | 20px | 600 | 1.3 | Dialog titles, page headings |
| `text-display` | 24px | 600 | 1.2 | Timecode readout |

### Spacing

4px base scale: `2, 4, 6, 8, 12, 16, 20, 24, 32`. The app is dense by design: default gap between controls is `8`, panel padding is `12`–`16`.

### Radius, elevation, motion

- Radius: `sm 4px`, `md 6px`, `lg 8px`, `pill 9999px`.
- Elevation: one subtle shadow token, used only for popovers and dialogs. The base UI is flat.
- Motion: `120ms` micro (hover, press), `180ms` standard (panel, popover), `240ms` larger transitions. Easing `cubic-bezier(0.2, 0, 0, 1)`.
- **The playhead and any live time indicator must never animate or transition** — they track real time.

## Accessibility

- Target **WCAG 2.2 AA**.
- **Keyboard-first is a product requirement, not a nicety** (PRD NFR-9). Every tagging action must be completable without a pointer. Focus is always visible: a `2px` `--accent` ring with `2px` offset.
- Shortcuts must be discoverable from the UI — shown on tag chips and in a shortcut panel — never only in documentation.
- **Never encode meaning in colour alone** (PRD NFR-10): tag and team colours must always be paired with a name, icon, or pattern.
- Minimum pointer target `24×24px`; timeline markers need at least `12px` visual width with a larger hit area.
- Respect `prefers-reduced-motion`; motion is decorative and never required to understand state.

## Writing Tone

Concise, plain, football-literate. Use the user's own vocabulary: match, event, tag, clip, pre-roll, post-roll, timeline. Buttons are verbs ("Export clip", "Delete event"). No exclamation marks, no marketing language inside the app, and never "AI" as a selling point.

## Rules: Do

- Use semantic tokens; never raw hex values in component code.
- Define every state: default, hover, focus-visible, active, disabled, loading, error.
- Keep chrome neutral so footage colours read accurately.
- Use tabular numerals for every timecode, count, and duration.
- State the affected count in every destructive confirmation.
- Give the video and timeline the most space and the least decoration.

## Rules: Don't

- Don't use low-contrast text or hide focus indicators.
- Don't animate the playhead or any real-time indicator.
- Don't rely on a tag's colour alone to identify it.
- Don't introduce one-off spacing or typography exceptions.
- Don't put a destructive action behind a single click.
- Don't cover video with tinted or blurred overlays.

## Component rules

**Timeline** — Full-width horizontal track above the transport. Must show the playhead, event markers, and a time ruler; must support zoom and pan by pointer and keyboard. Markers are positioned by `start_ms`. A marker label appears only when there is room, at `text-caption`. Hovering a marker raises it and shows the tag name and timecode. The playhead never animates.

**Event marker** — A vertical tick with a tag-coloured cap. States: default, hover, selected, active (currently playing). Must include a non-colour cue for hover and selection. Hit area at least `12px` wide.

**Event row** — Used in the event list. Layout: timecode (mono, tabular) · tag chip · team and player · note indicator. The selected row uses `--bg-raised` plus a left accent border. Long notes must truncate with an expand affordance.

**Tag chip** — Pill with the tag's colour as a dot or left edge, plus the tag name at `text-label`. The name is always present, never colour alone. The deletable variant confirms with the affected event count.

**Transport bar** — Play/pause, frame step, speed, timecode readout (mono, tabular), and the review-mode toggle. Keyboard hints appear on hover.

**Job / toast** — Determinate progress bar when the total is known, indeterminate otherwise. States: queued, running, done, failed, cancelled. Failures persist until dismissed and state what to do next.

**Dialogs** — Used for destructive confirmations, match creation, and settings. Title at `text-heading`; primary action on the right; the destructive action uses `--danger` and never autofocuses.

**Empty states** — Explain the next action in one sentence and offer it ("Import a match video"). No illustration required, but never an empty panel without explanation.

**Drawing layer** — Sits on the video's **content rect**, never on the element, so a shape stays over the same pixels in a letterboxed window and in an export. The canvas is presentational; the **layers panel is the accessible surface** — selection, reorder and delete are reachable by keyboard and readable by a screen reader. Transform handles are DOM controls, at least `24×24px` with an `11px` hit radius, and are never painted into the video. Drawing happens on a paused frame only, and an active tool **must suppress tag shortcuts** (no keystroke creates an event). The layer redraws on change, never on a timer.

**Pitch outline and markers** — The outline is a verification aid, not decoration: it is drawn over the frame in `#22D3EE` at a thin weight so it reads as a check against the pitch lines underneath. Reference-point markers are numbered, `16px`, and draggable so a point can be finished by eye. **Only the part of the pitch the reference points support is drawn**; where the picks do not reach, an outline would be extrapolation and is omitted rather than shown as fiction.

**Pitch view** — A top-down schematic in metres, drawn from the same model as the frame outline so the two can never disagree. Every marker carries the shirt number and the team name, and a comparison uses **shape as well as colour** (filled disc against dashed ring). No positions for the moment ⇒ say so; never an empty pitch that looks like a bug. An uncalibrated video explains and shows nothing.

**Position markers on the frame** — Shown while the playhead is inside the event's own range, hidden outside it, because a marker only tells the truth at its anchor moment. **Marking keeps them visible** wherever the playhead is, since placing a point needs the existing ones as context. The rule is stated in the panel rather than left to be discovered.

**Calibration honesty states** — Three states must be visible and distinct, never blended: the fit is **good** (≤2 px), **acceptable** (2–6 px), or **poor** (>6 px, refused with the suspect point named). Coverage is reported as a share of the **pitch**, not the frame, and a narrow region is a warning rather than a silent fact. A quality warning is text at `text-label` in `--warning`, never a colour-only cue.

**Magnified picker** — A full-stage overlay showing the paused frame at full resolution with zoom and pan, the pitch outline and markers drawn on the same canvas so a click cannot disagree with what is shown. It serves both calibration and player marking. Escape closes it, and the header always states what a click will do.

**Drawings in an export** — The burn-in option is **off by default**. When enabled, the panel states the cost plainly: the clip re-encodes, so it takes as long as an accurate cut. A clip whose event has no drawings is unaffected and must not be made slower.

## Quality gates

- Every non-negotiable rule uses **must**; every recommendation uses **should**.
- Every accessibility rule must be testable in implementation.
- Before shipping a screen: keyboard-only pass, contrast check on dark surfaces, tabular-numeral check on all timecodes, and all component states implemented.
- Prefer system consistency over local visual exceptions.
