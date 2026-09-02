# Repository Guidelines

## Project Structure & Module Organization

- `apps/game/` contains the Vite web app: React HUD and app flow in `src/`, raw Three.js rendering in `src/rendering/`, and native WebMCP registration in `src/webmcp/`.
- `packages/game-engine/` contains the browser-authoritative Effect engine, state/types, schemas, fixtures, failures, and deterministic rules.
- Tests live beside their package under `src/**/*.test.ts`; Playwright journeys are under `apps/game/src/tests/e2e/*.spec.ts`.
- `docs/` holds the implementation specification and game design. Keep static game content in TypeScript modules; do not add a backend or duplicate gameplay state in React/Three.js.

## Build, Test, and Development Commands

Run these from the repository root with Node.js 22+ and npm 10.9.8+:

```bash
npm install                 # install workspace dependencies
npm run dev                 # start the game at the Vite dev server
npm run check               # Biome check, typecheck, and unit tests
npm run build               # build all Turbo workspaces
npm test                    # run Vitest suites
npm run test:e2e            # run one serialized desktop Chromium Playwright journey suite
npm run format              # format the repository with Biome
```

## Coding Style & Naming Conventions

Use TypeScript and two-space indentation; Biome enforces spaces, a 100-column line width, recommended lint rules, and import organization. Use `camelCase` for variables/functions, `PascalCase` for React components and types, and descriptive lower-case filenames (for example, `app-model.ts` and `journey.spec.ts`). Keep commands, queries, and state transitions explicit and deterministic.

## Testing Guidelines

Vitest covers engine, coordinator, app-model, and WebMCP adapter behavior. Playwright covers desktop browser journeys in one serialized Chromium worker to limit local CPU and memory use. Add focused `*.test.ts` tests for domain changes and `*.spec.ts` tests for end-to-end flows; run `npm run check` before submitting. No coverage threshold is configured, so exercise every changed branch, especially refusal and progression paths.

## Architecture & WebMCP Boundaries

The browser engine is the single source of truth for human controls and `document.modelContext` tools. Preserve structured refusal outcomes such as `HUMAN_DISCOVERY_REQUIRED` and `DIRECTIVE_BLOCKED`; do not bypass them with UI-only mutations or hidden query data. Hosted WebMCP behavior still requires HTTPS and a supported Chrome origin-trial environment.

For engine, runtime, or WebMCP changes, read [`docs/knowledges/wildgent-runtime/README.md`](docs/knowledges/wildgent-runtime/README.md) and update the relevant knowledge files when behavior changes.

## Commit & Pull Request Guidelines

Use concise Conventional Commit messages, such as `feat: add relay inspection` or `fix: preserve battle directive`. PRs should explain the user-visible flow, list validation commands, link the issue when applicable, and include screenshots or a short recording for UI/gameplay changes.
