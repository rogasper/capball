# Contributing

Thanks for looking. This is a small, local-first desktop app, and the most useful contribution is often a clear bug report rather than a large patch.

## Getting set up

```bash
bun install
bun run tauri dev
```

You will need `bun`, a stable Rust toolchain, Xcode command line tools on macOS, and FFmpeg on your `PATH`. If FFmpeg is missing, the app still runs — importing and tagging work, and the parts that need it say so.

## Before you open a pull request

Run all four and fix what they report:

```bash
bun run lint
bun run typecheck
bun run test
cargo test --manifest-path src-tauri/Cargo.toml
```

The tests include integration tests that run the shipped SQL against a real SQLite database. If you add a query, add a test there — the unit tests mock the query layer, so they cannot catch a broken statement.

## What makes a change easy to accept

- **One requirement or one milestone per pull request.** Mixing a refactor with a feature makes both harder to review.
- **Conventional Commits**, with the requirement id where one applies: `feat(tagging): one-key capture (FR-5.1)`.
- **A test for behaviour you add.** Especially for anything that decides what the user loses: deleting a tag, refusing an export, clamping a clip range.
- **No new dependency without a reason.** The project prefers the platform and a small set of well-maintained libraries, and `AGENTS.md` records why.

## Architecture rules worth knowing

`AGENTS.md` is the authority, but three rules explain most review comments:

1. `src/lib/ipc/` is the only module allowed to import from `@tauri-apps/*`. Everything else goes through its typed wrappers, which is what keeps the frontend testable without a running shell.
2. `src-tauri/` holds no domain logic. It moves bytes and runs processes; decisions live in TypeScript.
3. Every projected column in a joined select needs an explicit unique alias. The SQL plugin returns rows keyed by column name, so two columns called `name` silently collapse into one.

## Reporting a bug

Include what you did, what you expected, and what happened. If it involves a specific video, saying so helps a lot, but **please do not attach copyrighted footage** — a description of the file (container, codecs, frame rate, duration) is usually enough, and `ffprobe` prints exactly that.

## Design and UI

`DESIGN.md` holds the tokens and the rules. The short version: dark, neutral, dense, keyboard-first, and colour is never the only thing carrying meaning.

## Licence

By contributing you agree that your work is licensed under AGPL-3.0, the licence of this project.
