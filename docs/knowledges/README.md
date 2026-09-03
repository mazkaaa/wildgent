# WildGent Internal Knowledge

This is the canonical, code-grounded knowledge index for the WildGent monorepo. Product intent and
MVP decisions remain in [`docs/GAME_DESIGN.md`](../GAME_DESIGN.md) and [`docs/SPEC.md`](../SPEC.md);
this directory describes what the current implementation actually does.

## Domains

- [WildGent runtime](./wildgent-runtime/README.md) — engine state and transitions, app/coordinator
  behavior, Three.js presentation, WebMCP registration, persistence, and local verification.

The runtime is documented as one multi-file pack because it spans the engine package and the game
application, has more than six commands/tools, uses multiple state contracts, and crosses several
presentation and browser boundaries.

## Source-of-truth order

1. Executable TypeScript under `packages/game-engine/src/` and `apps/game/src/`.
2. Vite, Wrangler, TypeScript, Biome, and Turbo configuration.
3. Workspace package scripts and lockfile.
4. Unit tests and manual built-in-browser acceptance.
5. Existing Markdown, including product references.

Knowledge files are hand-written. Generated build output belongs under ignored `dist/` directories,
not under `docs/knowledges/`.
