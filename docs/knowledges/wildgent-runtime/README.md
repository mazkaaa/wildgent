# WildGent Runtime Knowledge

## Owning code areas

- `packages/game-engine/src/` — authoritative aggregate, commands, queries, schemas, fixtures,
  failures, and persistence.
- `apps/game/src/` — React app projection, mutation coordinator, Three.js scene, and WebMCP adapter.
- `apps/game/src/tests/` — model, coordinator, and adapter coverage; gameplay is manually checked in the built-in browser.

## Purpose

WildGent is a client-only cooperative creature adventure. The browser engine owns all gameplay
state; the React HUD, Three.js scene, and Echo WebMCP tools consume that state through narrow seams.
The current slice starts a New Journey or Judge Demo, restores Voltyn's relay, opens the ruins,
requires a human discovery, resolves one guardian encounter, and claims the Ancient Core.

## Pack contents

- [Engine and persistence](./engine.md)
- [App runtime and presentation](./app-runtime.md)
- [WebMCP surface](./webmcp.md)
- [Development and verification](./development.md)

## Architectural invariants

- `WildGentGameEngine` is the only authoritative state store.
- Commands return structured accepted/refused results; refusal must not fabricate progress.
- `ActionCoordinator` serializes mutations and holds the presentation lock until the scene settles.
- WebMCP accepts semantic target IDs only; arbitrary coordinates are not exposed to Echo.
- Human-only discovery and the human-owned Avoid battles directive remain engine-enforced.

## Common drift areas

Keep `app-model.ts` normalization and the engine schema aligned when state fields change. Update
tool descriptions and tests when command names or target visibility changes. Check fixture positions,
objective precedence, and the WebMCP capability registration after progression changes.

## Verify before editing

- Read the relevant source and its adjacent tests.
- Confirm whether the change belongs in engine state, app projection, or presentation only.
- Preserve structured failure codes and actor context.
- Run `npm run check`, `npm run build`, and the focused browser journey.
