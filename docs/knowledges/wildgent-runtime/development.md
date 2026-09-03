# WildGent Development and Verification

## Requirements and workspace

Use Node.js 22 or newer and npm 10.9.8 or newer. The root npm workspace contains `apps/game` and
`packages/game-engine`; Turbo orchestrates package scripts. Install dependencies with `npm install`.

## Local commands

- `npm run dev` starts the Vite game server for `@wildgent/game` at `127.0.0.1:5173`.
- `npm run check` runs Biome, both package typechecks, and Vitest suites.
- `npm run build` builds all Turbo workspaces for production.
- `npm test` runs all Vitest suites.
- `npm run format` applies Biome formatting; inspect the diff before keeping changes.
- Deploy with `npm run build` followed by `npm run deploy`; Wrangler publishes the existing `dist/`
  output as Cloudflare static assets.

## Test locations

Engine rules and persistence tests are in `packages/game-engine/src/engine.test.ts`. App projection
and objective tests are in `apps/game/src/tests/app-model.test.ts`; coordinator ordering and lock
tests are in `coordinator.test.ts`; WebMCP registration and tool behavior are in
`apps/game/src/webmcp/index.test.ts`. WebMCP adapter behavior is unit-tested, while gameplay and
external-agent WebMCP acceptance are manually verified in a supported built-in browser.

## Style and review

Biome is authoritative: TypeScript uses two spaces, recommended lint rules, import organization,
and a 100-column width. Keep state transitions explicit and deterministic. Add focused tests for
new refusal/progression branches and manual built-in-browser rehearsal for user-visible flows.
Before review run `npm run check`, `npm run build`, and `git diff --check`.

## Deployment configuration

Vite serves the SPA from `apps/game`; `apps/game/wrangler.jsonc` deploys `dist/` with SPA fallback.
There are no required application environment variables in source. `.env*`, Wrangler state, test
reports, build output, and credentials are ignored; never commit WebMCP origin-trial tokens or
private keys. Keep product requirements in `docs/GAME_DESIGN.md` and `docs/SPEC.md`.
