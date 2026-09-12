# capball

[![CI](https://github.com/rogasper/capball/actions/workflows/ci.yml/badge.svg)](https://github.com/rogasper/capball/actions/workflows/ci.yml)

Local-first football match analysis. Import your own match video, tag moments with a single keystroke while you watch, and export clips around them.

Everything runs on your machine. No account, no upload, no backend.

![The match workspace: video, tagging context, timeline, capture status and transport, with the event list beside it](docs/screenshots/match-workspace.png)

## Status

**R0 is feature-complete and deliberately not released.** It is a working tagging tool: import a match, tag it, review it, export clips. It is not yet the analysis tool the project is aiming at — drawing on the video, tagging individual players, and a pitch view with player positions are planned for a later release and will need their own requirements document first. See [`plans/roadmap.md`](plans/roadmap.md) *(kept locally; see [Documentation](#documentation))*.

## What works today

- **Import** one or more videos per match — halves, or several camera angles. Anything the OS player cannot open directly is prepared for you, losslessly where possible, with progress.
- **Playback** with full keyboard control: play, seek, frame step, speed, and a transport that keeps up with large 1080p files.
- **Your own taxonomy**: categories and nested tags, colours, and the keys you bind to them. A standard football vocabulary ships as an editable starting point.
- **One-key capture** while watching, with pre-roll and post-roll you set once. Events inherit the team and player you are currently focused on.
- **A timeline** you can zoom, pan, click to seek, drag to select a range from, and filter by tag, team or player.
- **Events** in chronological order, each jumpable, each with a note, each carrying the moment you actually tagged.
- **Review mode** that plays a filtered set back to back.
- **Clip export**, single or in bulk, fast or frame-accurate, optionally joined into one file, with file names templated from match, tag and time. Existing files are never overwritten.
- **Thumbnails**, **analysis export**, and **taxonomy export/import** so a vocabulary can be shared.

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

## Requirements

- macOS 12.3 or later (Windows and Linux are planned)
- [bun](https://bun.sh)
- Rust toolchain (stable) and Xcode command line tools for the desktop build
- FFmpeg — detected at startup. If it is missing, importing and tagging still work; preparing files and exporting need it, and the app says so and points you at an install rather than failing later.

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
| Unit and integration tests | `bun run test` |
| Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml` |
| Generate a database migration | `bun run db:generate` |
| Generate test footage | `./scripts/make-demo-clip.sh` |

## Project structure

```text
src/features/   one slice per product area: library, player, timeline, tagging, events, review, export, settings
src/lib/        ipc (the only place that talks to Tauri), db (Drizzle), media, jobs, playback, time, settings, transfer
src-tauri/      thin Rust shell: plugins, commands, subprocess jobs
tests/          unit tests, and integration tests that run the shipped SQL against real SQLite
```

## Documentation

Committed to this repository:

- [`DESIGN.md`](DESIGN.md) — design system, tokens, and UI rules
- [`AGENTS.md`](AGENTS.md) — instructions for coding agents, including the architecture rules

Kept locally and intentionally not published: the product requirements, technical design, roadmap, and architecture decision records. They are working documents that change faster than the code.

## Test media

This repository ships **no match footage**, and it never will. Generate synthetic clips for development and tests:

```bash
./scripts/make-demo-clip.sh
```

This writes an H.264/AAC MP4 (plays directly) and an equivalent Matroska file into `tmp/demo/`, which is gitignored.

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`AGENTS.md`](AGENTS.md) before opening a pull request. In short: run `bun run lint`, `bun run typecheck`, `bun run test`, and `cargo test --manifest-path src-tauri/Cargo.toml` before submitting, and use Conventional Commits.

## Licence

AGPL-3.0 — see [`LICENSE`](LICENSE).

You are responsible for the footage you analyse with this tool.
