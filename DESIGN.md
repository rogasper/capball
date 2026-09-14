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

**Timeline tracks** — The timeline is a **track per tag**, the way an editor is: a lane for each tag that has something in view, headed by a colour swatch, the tag's name, its key binding and its event count, in the user's own taxonomy order so the lanes never rearrange themselves. **The header is the filter** — clicking a tag narrows the timeline to it. A tag's overlapping events take sub-rows inside its own lane rather than stealing another tag's row. The lanes scroll vertically, capped so the timeline cannot eat the video, and the ruler stays pinned; the playhead and the range selection are drawn **across every track**, so a time reads across all of them.

**Timeline spans** — An event is drawn as a **bar from its clip start to its end**, not as a tick at its moment: the duration is half of what an event is, and the export uses it. Overlapping events take separate rows so neither hides the other; past six rows the lane stops growing rather than eating the video, and a zoomed-out event keeps a minimum width so it stays clickable. The moment is drawn inside its own bar, because that is still the thing the user tagged.

**Editing a span** — Drag the body to move the clip in time, with its moment travelling inside it; drag either end to trim. The two trim grips are **separate buttons with their own labels**, so a move never becomes a trim by accident, and a focused bar takes the same edit from the keyboard (an arrow key moves it a second, Shift five). One write per gesture, and the bar returns to its stored range if the write fails. A bar shorter than a fifth of a second is not a clip, so trimming stops there.

**Zoom** — In, out and fit hold the **playhead** still, not the middle of the lane: on a fifty-minute match, zooming that slides the moment being watched is what makes the control unusable. The pointer's own zoom (⌘-scroll) anchors on the pointer, which is what a trackpad user expects. The playhead and anything drawn from the clock are placed whenever the **viewport** changes too, not only on playback frames, so a paused zoom cannot leave them stale.

**When a drawing is on screen** — A drawing's visibility is one of four, and the panel always shows **which one is in effect**: its own moment (a length), a range of its own, the event's clip, or the whole clip. A range of its own is a **span with two edges**, set from the playhead ("Start here", "End here") or widened to the whole event, and drawn as a bar over the event's own span so a range that falls outside the event is visible rather than silent. Choosing a mode removes a range, because a range wins: a control that appears to do nothing is worse than one that is missing. A drawing's own range does **not** follow the event when the event is moved, and the panel says which of the two a shape is using.

**Stroke style** — A line's pattern is part of what it *means*, not decoration: **solid** is the ball played, **dashed** a player's run, **dotted** a carry, **dash-dot** pressure. The five named presets (Pass, Run, Dribble, Press, Cover) set the pattern, colour, weight and head together, so the notation is learned rather than configured; the pattern is measured in stroke widths, so the preview and the exported clip show the same rhythm. A preset never touches a fill. Two strokes are never told apart by colour alone (NFR-24).

**Label** — A shape's words are **drawn with it**, in the app and in the clip. A label sits on its own background with a text colour derived from that background, outside the shape's own bounds so it covers nothing, kept inside the picture, and truncated at a legible maximum — the panel always has the whole text. A text shape draws its words once, never twice.

**Sidebar panel** (the left and right `aside`s) — A panel is a **vertical** scroller and never scrolls sideways. Content wraps, or shrinks with `min-w-0` and truncates with the full value in a `title` — never a fixed width narrower than its own label, and never a control whose text cannot shrink, because a flex item's automatic minimum is its content: a long placeholder is how a whole panel came to be pushed off its own left edge. A field showing a default renders that default **quietly**, with a border on hover; a non-default, active state keeps its border, since a box on every row is what makes a dense panel read as a grid.

**Select field** — `min-w-0` on the trigger whenever it shares a row, and options named by **behaviour or value** rather than by a noun that reads as a command ("One press" / "Until stopped", not "phase"). A long current value truncates, with the full text in a `title`.

**Splitting an event** — Cutting at the playhead produces two events that meet there. The **first** half keeps the id, the drawings, the positions and the notes, because all of those were about the moment it still has; the second is a new event with the same tag, team and player, so nothing has to be re-tagged to carry on. The split is refused, with a reason, when the playhead is outside the clip.

**A filter must not look like loss** — When a filter is active the timeline says how many events it is showing of how many exist, next to the events themselves rather than only on the control that set the filter. Hiding was mistaken for losing, which is how the timeline work in this release started.

**Team colour** — Set per team in the squad panel, and the one colour that follows a team everywhere: the marker on the pitch, the position on the frame, the marking swatches. It is **never the only signal** — a marker always carries the shirt number (or the player's initials when no number is recorded) and the team's name. The number is drawn with a halo in the surface colour, so it stays readable on any team colour in either theme. Clearing the colour is a first-class choice, and the marker falls back to the neutral.

**Pitch view** — A top-down schematic in metres, drawn from the same model as the frame outline so the two can never disagree. Every marker carries the shirt number and the team name, and a comparison uses **shape as well as colour** (filled disc against dashed ring). No positions for the moment ⇒ say so; never an empty pitch that looks like a bug. An uncalibrated video explains and shows nothing — and offers the calibration, since drawing on the pitch needs the perspective first.

**Drawing on the pitch** — The tools that belong on a plane are offered there (rectangle, ellipse, line, arrow, zone by clicks); **freehand and text are not**, and the panel says where they belong rather than leaving dead controls. Drawing is **one-shot**: a committed shape hands the diagram back to selecting, so no tool stays armed to swallow the next click. A tool belongs to the **surface that armed it** — picking one on the pitch leaves the video free to select and play, and vice versa. That is a rule, not an implementation detail: one shared "tool" is what made the whole app feel locked.

**The angled pitch view** — A second camera on the **same flat plane**: pitch metres, recorded shapes and markers, all on `y = 0`. No height is invented, no player is drawn as a body, and a marker is a label floating over its position rather than a figure standing there. Two fixed poses (broadcast and a steeper tactical one) with their fields of view **derived from the pitch** so nothing is ever clipped; a free orbit is deliberately absent, because a view from inside the ground has no analytical value and a camera that can be anywhere cannot be checked. Markers are sprites, so they face the camera and stay readable at any angle, and team colour is still never the only signal.

**Drawing at an angle** — A click is a ray, and a ray meets the ground in exactly one place, so the shape lands where it was clicked. Measured rather than assumed: a screen pixel is worth **0.27 m at worst**, so a sloppy three-pixel click stays inside a metre. One shape per gesture, then the diagram returns to selecting — the same rule the top-down view uses.

**Reshaping stays top-down** — A grip drag needs a *linear* pixel-to-metre mapping, which a perspective divide is not. The angled view draws and moves; the top-down view reshapes corners, and the panel says so instead of offering a grip that would drift.

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
