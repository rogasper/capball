# capball

[![CI](https://github.com/rogasper/capball/actions/workflows/ci.yml/badge.svg)](https://github.com/rogasper/capball/actions/workflows/ci.yml)

Local-first football match analysis. Import your own match video, tag moments with a single keystroke while you watch, and export clips around them.

Everything runs on your machine. No account, no upload, no backend.

> **Status: early foundation (M0).** The app currently opens an empty window — import, playback, and tagging are not implemented yet. The milestones and their definitions of done are tracked locally (see [Documentation](#documentation)).

## Why

Most match-analysis tooling is built for clubs: expensive, complex, and designed around a team workflow. capball is for a fan who wants to build a personal knowledge base — their own vocabulary of tactical concepts, their own library of moments across matches, their own clips.

It deliberately starts with manual tagging and keeps computer vision out of the core. If analysis assistance arrives later, it proposes candidate moments for review; it is never the centre of the product, and it never decides for you.

## Planned features (release 0)

- Import one or more local videos per match — halves, or multiple camera angles
- Playback with full keyboard control: play, seek, frame step, speed
- A timeline built for analysis: markers, zoom, pan, and filtering by tag, team, or player
- Your own tag taxonomy — nested categories, colours, and key bindings you choose
- One-keystroke capture with configurable pre-roll and post-roll
- Active team and player context, so each event records who it was about
- Clip export, single or in bulk, with an optional concatenated file
- Review mode: play a filtered set of moments back to back
- Export and import of analysis data and taxonomies

## Stack

| Layer | Choice |
| --- | --- |
| Desktop shell | Tauri 2 |
| Frontend | React + TypeScript + Vite |
| UI | Tailwind CSS + shadcn/ui |
| Client state | Zustand |
| Database | SQLite via `tauri-plugin-sql`, with Drizzle ORM (`sqlite-proxy` driver) |
| Media processing | FFmpeg, invoked as a subprocess |
| Package manager | bun |

Decision records for the significant choices live in `plans/adr/` locally — see [Documentation](#documentation).

## Requirements

- macOS 12.3 or later (Windows and Linux are planned)
- [bun](https://bun.sh)
- Rust toolchain (stable) and Xcode command line tools for the desktop build
- FFmpeg — detected at first run; the app guides you through installing it if it is missing

## Getting started

```bash
bun install

# Desktop app — the real development target
bun run tauri dev

# Frontend only, in a browser. Useful for UI work, but Tauri APIs are unavailable.
bun run dev
```

## Scripts

| Task | Command |
| --- | --- |
| Frontend dev server | `bun run dev` |
| Desktop app | `bun run tauri dev` |
| Production desktop build | `bun run tauri build` |
| Lint / format | `bun run lint` / `bun run format` |
| Typecheck | `bun run typecheck` |
| Unit tests | `bun run test` |
| Generate a database migration | `bun run db:generate` |
| Generate test footage | `./scripts/make-demo-clip.sh` |

## Project structure

```text
src/features/   one slice per product area (library, player, timeline, tagging, events, review, export, settings)
src/lib/        ipc (the only place that talks to Tauri), db (Drizzle), media, jobs, playback
src-tauri/      thin Rust shell: plugins, commands, subprocess jobs
tests/unit/     Vitest unit tests
scripts/        demo footage generator
```

## Documentation

Committed to this repository:

- [`DESIGN.md`](DESIGN.md) — design system, tokens, and UI rules
- [`AGENTS.md`](AGENTS.md) — instructions for coding agents working on the project

Kept locally and intentionally not published: the product requirements, technical design, roadmap, and architecture decision records. They are working documents, not deliverables, and they change faster than the code.

## Test media

This repository ships **no match footage**, and it never will. Generate synthetic clips for development and tests:

```bash
./scripts/make-demo-clip.sh
```

This writes an H.264/AAC MP4 (plays directly) and an equivalent Matroska file into `tmp/demo/`, which is gitignored.

## Contributing

Read [`AGENTS.md`](AGENTS.md) before opening a pull request. It documents the architecture rules, the testing expectations, and the commit conventions. In short: run `bun run lint`, `bun run typecheck`, and `bun run test` before submitting, and use Conventional Commits with requirement IDs where they apply.

## Licence

AGPL-3.0 — see [`LICENSE`](LICENSE).

You are responsible for the footage you analyse with this tool.
