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

**Reshaping a shape** — Two kinds of grip, told apart by **size and border as well as colour**: a solid `9px` corner and a hollow `6px` add-grip on each edge. Dragging a rectangle's corner is still a resize; a polygon drags one vertex at a time, and shows no bounding box because its corners are its grips. Adding or removing a corner **converts the shape to a polygon**, and the whole edit is one undo step that restores the geometry *and* the kind. A corner is removed with `Delete` while it is focused, or with a double click; the grip's label says both. Shapes whose corners are not a design — ellipse, text, freehand — keep R1's transform only, and the inspector says so in words rather than leaving a control missing.

**Fill patterns** — A fill is a choice: **solid, hatch, cross-hatch, or outline only**. The pattern is generated from the shape's geometry by the one renderer, never a texture, so it stays crisp at export resolution. Hatch spacing is a fraction of the picture's width, like a stroke's weight, and the number of lines is capped — a full-pitch zone grows its spacing rather than its cost. The **line colour and the fill colour are independent**, and a pattern is what lets two zones be told apart with colour removed, which is the NFR-24 rule. An outline-only zone is how a space is marked without hiding the players in it.

**Pitch outline and markers** — The outline is a verification aid, not decoration: it is drawn over the frame in `#22D3EE` at a thin weight so it reads as a check against the pitch lines underneath. Reference-point markers are numbered, `16px`, and draggable so a point can be finished by eye. **Only the part of the pitch the reference points support is drawn**; where the picks do not reach, an outline would be extrapolation and is omitted rather than shown as fiction.

**Two drawing spaces** — A shape is anchored either to the **frame** (fractions of the picture, fixed to the pixels it was drawn on) or to the **pitch** (metres, projected into the camera's perspective). The surface decides, never a global setting: the video draws on the frame, the pitch view draws in metres, and each says which in words where the tools are. A frame shape never appears in a pitch view and never moves when a calibration is corrected; a pitch shape does both, and the app says so before the user discovers it. A projected pitch shape is drawn by the one renderer like any other, so it looks the same on the frame, in a clip and in a report.

**Team colour** — Set per team in the squad panel, and the one colour that follows a team everywhere: the marker on the pitch, the position on the frame, the marking swatches. It is **never the only signal** — a marker always carries the shirt number (or the player's initials when no number is recorded) and the team's name. The number is drawn with a halo in the surface colour, so it stays readable on any team colour in either theme. Clearing the colour is a first-class choice, and the marker falls back to the neutral.

**Pitch view** — A top-down schematic in metres, drawn from the same model as the frame outline so the two can never disagree. Every marker carries the shirt number and the team name, and a comparison uses **shape as well as colour** (filled disc against dashed ring). No positions for the moment ⇒ say so; never an empty pitch that looks like a bug. An uncalibrated video explains and shows nothing — and offers the calibration, since drawing on the pitch needs the perspective first.

**Drawing on the pitch** — The tools that belong on a plane are offered there (rectangle, ellipse, line, arrow, zone by clicks); **freehand and text are not**, and the panel says where they belong rather than leaving dead controls. Drawing is **one-shot**: a committed shape hands the diagram back to selecting, so no tool stays armed to swallow the next click. A tool belongs to the **surface that armed it** — picking one on the pitch leaves the video free to select and play, and vice versa. That is a rule, not an implementation detail: one shared "tool" is what made the whole app feel locked.

**Editing a shape on the pitch** — Click to select, drag to move, corner grips to resize, the rotate grip to turn, the hollow edge grips to add a corner, `Delete` on a focused corner to remove it, `Delete` to remove the shape. A pitch shape is manipulated **on the pitch view** and nowhere else: its numbers are metres, so a hit test over the video would be a guess. On the video it is shown, and clicking it there selects it and says where it is edited. In the Layers panel it reads "on the pitch". A shape whose projection reaches outside the area the calibration covers is drawn as a **guide** and counted in a caption; a shape entirely outside it is **not drawn at all** and also counted. The caption is computed by the same function the canvas draws with, so the numbers and the picture cannot disagree.

**Position markers on the frame** — Shown while the playhead is inside the event's own range, hidden outside it, because a marker only tells the truth at its anchor moment. **Marking keeps them visible** wherever the playhead is, since placing a point needs the existing ones as context. The rule is stated in the panel rather than left to be discovered.

**Calibration honesty states** — Three states must be visible and distinct, never blended: the fit is **good** (≤2 px), **acceptable** (2–6 px), or **poor** (>6 px, refused with the suspect point named). Coverage is reported as a share of the **pitch**, not the frame, and a narrow region is a warning rather than a silent fact. A quality warning is text at `text-label` in `--warning`, never a colour-only cue.

**Magnified picker** — A full-stage overlay showing the paused frame at full resolution with zoom and pan, the pitch outline and markers drawn on the same canvas so a click cannot disagree with what is shown. It serves both calibration and player marking. Escape closes it, and the header always states what a click will do.

**Drawings in an export** — The burn-in option is **off by default**. When enabled, the panel states the cost plainly: the clip re-encodes, so it takes as long as an accurate cut. A clip whose event has no drawings is unaffected and must not be made slower.

## Quality gates

- Every non-negotiable rule uses **must**; every recommendation uses **should**.
- Every accessibility rule must be testable in implementation.
- Before shipping a screen: keyboard-only pass, contrast check on dark surfaces, tabular-numeral check on all timecodes, and all component states implemented.
- Prefer system consistency over local visual exceptions.
