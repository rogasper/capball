# AGENTS.md

This file tells coding agents how to work in this repository. It complements `README.md`, which is for humans.

## Project overview

**capball** is a local-first desktop application for football fans who analyse matches. A user imports their own match video, tags moments with one keystroke while watching, and exports clips around those moments. Everything runs on the user's machine: no backend, no upload, no account.

- Licence: **AGPL-3.0**
- Stack: React + TypeScript + Vite frontend, **Tauri 2** shell, SQLite via `tauri-plugin-sql` with **Drizzle ORM** (`sqlite-proxy` driver), **FFmpeg as an external subprocess**, Tailwind + shadcn/ui, Zustand for client state
- Platform: macOS first (minimum 12.3); Windows and Linux later

**Current stage: planning.** There is no application code yet — no `package.json` scripts, no `src/`, no `src-tauri/`. Do not scaffold or implement a feature until the roadmap milestone for it is active.

## Read before changing anything

| Document | Why |
| --- | --- |
| `plans/PRD.md` | Requirements with stable IDs (`FR-x`, `NFR-x`). Cite them in work. |
| `plans/technical-design.md` | Stack, architecture, project structure, data model, boundaries. |
| `plans/research.md` | Reference projects, reusable libraries, licensing boundary. |
| `plans/roadmap.md` | Milestones and definition of done (written before implementation starts). |
| `DESIGN.md` | Design system, tokens, and UI rules. |
| `plans/idea.md`, `plans/idea_implement.md` | Original background notes. Non-authoritative — the PRD wins. |

`plans/` is planning history. Do not rewrite earlier decisions in place; add a numbered ADR in `plans/adr/` or bump the version of the PRD / technical design.

## Commands

These are the intended scripts; they will exist once M0 lands. Check `package.json` before running — if a script is missing, the milestone that adds it has not happened yet.

| Task | Command |
| --- | --- |
| Install dependencies | `bun install` |
| Frontend dev server | `bun run dev` |
| Desktop dev (Tauri) | `bun run tauri dev` |
| Production desktop build | `bun run tauri build` |
| Lint / format | `bun run lint` / `bun run format` |
| Typecheck | `bun run typecheck` |
| Generate DB migration | `bun run db:generate` |
| Unit tests | `bun run test` |
| Unit tests (watch) | `bun run test:watch` |

Use **bun**, not npm, pnpm, or yarn.

## Architecture rules — do not violate

1. `src/lib/ipc/` is the **only** module allowed to import from `@tauri-apps/*`. Everything else imports typed wrappers from there. This keeps the frontend testable without a running Tauri shell.
2. `src-tauri/` contains **no domain logic** — no "create event" commands. It moves bytes and runs processes.
3. `features/` must not import another feature's internals. Share through `stores/` or `components/`.
4. **Playback time never lives in Zustand.** It lives in the imperative playback controller (`src/lib/playback/`) and reaches the UI through subscriptions plus `requestAnimationFrame`. Putting it in a store re-renders the tree every frame.
5. Times are **integer milliseconds** (`_ms`). Never store a time as floating-point seconds.
6. Rust stays thin, and FFmpeg is invoked as a **subprocess**, never linked in-process.
7. Database access goes through `src/lib/db/` only, using **Drizzle ORM** over the `sqlite-proxy` driver. Never scatter raw SQL through features, and never open the database from a feature module.

## Code style

- TypeScript strict mode. Avoid `any`; if unavoidable, justify it in a comment.
- Functional React components and hooks only — no class components.
- Tailwind utilities plus shadcn/ui primitives for all UI. Follow the tokens in `DESIGN.md`.
- Zustand for client state. **Do not add TanStack Query** in R0.
- Match the surrounding code's comment density. Comment only constraints the code cannot express — never narrate what the next line does.

## Testing

- Unit tests live in `tests/unit` and run with Vitest via `bun run test`.
- Cover at minimum: timecode conversion, pre/post-roll clamping to video bounds, the remux decision tree, shortcut resolution and conflict rules, event undo/redo, export filename templating, review-queue ordering, and the tag-deletion impact count.
- Run lint, typecheck, and tests before finishing a task, and fix failures rather than reporting them.
- Tauri end-to-end tests are deliberately out of scope for R0. Manual QA follows the checklist in `plans/`.

## Commits and pull requests

- Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- Reference requirement IDs, for example `feat(tagging): one-key capture (FR-5.1)`.
- Keep a change scoped to one requirement or milestone. Do not mix refactors with features.

## Security and data safety

- Keep filesystem and asset-protocol scopes limited to folders the user explicitly selected. **Never** widen to `$HOME/**` — the reference implementation's broad scope is an anti-pattern we deliberately avoid.
- Never commit video files, exported clips, FFmpeg binaries, caches, or a populated database; they are gitignored for a reason.
- The repository ships **no copyrighted footage**. Test media is generated synthetically by `scripts/make-demo-clip.sh`.
- Deleting a tag deletes its events (PRD OQ-6). Any UI doing this **must** show the affected event count and require explicit confirmation.
- Failures must be visible: no silent `catch`. Jobs surface state through the job store; user-facing errors surface as toasts.

## Where things live

```text
src/features/<area>/   one vertical slice per PRD area
src/stores/            Zustand domain stores
src/lib/               ipc, db, media, jobs, playback, time helpers
src-tauri/             thin Rust shell: plugins, commands, sidecar jobs
plans/                 PRD, technical design, research, roadmap, ADRs
DESIGN.md              design system and UI rules
scripts/               demo clip generator and helper scripts
tests/unit/            Vitest unit tests
```
