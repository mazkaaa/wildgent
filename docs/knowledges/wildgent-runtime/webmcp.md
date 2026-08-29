# WildGent WebMCP Surface

## Owning code

- `apps/game/src/webmcp/index.ts` — feature detection, registration lifecycle, capability sync,
  duplicate handling, and disposal.
- `apps/game/src/webmcp/tools.ts` — tool schemas, input validation, dispatch/query wrappers, and
  structured result conversion.
- `apps/game/src/webmcp/types.ts` — local structural types for `document.modelContext`, tools,
  execution signals, and the engine port.
- `apps/game/src/main.tsx` — browser registration bootstrap and unload cleanup.

## Registration

`registerWebMcp` starts registration immediately and returns a `ready` promise. The adapter first
checks `document.modelContext.registerTool`. It registers static tools once, subscribes to engine
snapshots, and registers `interface` only after the snapshot proves Resonance is available.
Duplicate registration errors are reported separately; disposal aborts pending registrations and
unsubscribes from capability updates. Unsupported browsers remain playable manually.

## Static tools

The static surface is `get_game_state`, `look_around`, `move`, `inspect`, `interact`, `get_party`,
`battle_action`, `ignite`, and `break`. `get_game_state`, `look_around`, and `get_party` are marked
read-only. Mutations accept structured target IDs; `move` can approach a visible landmark or an
available route, but never accepts arbitrary coordinates. Target-specific actions must satisfy
engine visibility, capability, phase, discovery, and proximity rules.

`interface` is registered dynamically after Voltyn Resonance and uses the same target-only schema.
All tools pass `{ actor: "agent", source: "webmcp", toolName, signal }` to the game port. Abort
signals return `CANCELLED`; malformed inputs return `INVALID_INPUT`; engine refusals preserve their
structured code and message, including `BUSY`, `OUT_OF_RANGE`, `DIRECTIVE_BLOCKED`, and
`HUMAN_DISCOVERY_REQUIRED`.

## Browser and hosting boundary

The integration is imperative and native: it does not create a server or a second game state.
Local testing requires a WebMCP-capable Chrome testing flag when available. Hosted acceptance needs
HTTPS and the event-supported WebMCP origin-trial or preview environment. Vitest mocks verify the
registration and adapter contract; only a real supported browser/agent proves external discovery
and invocation.

## Verify changes

Update `apps/game/src/webmcp/index.test.ts` when tool registration or lifecycle changes. Update
tool tests when schemas, target IDs, or failure conversion changes. Confirm `get_game_state` and
`look_around` expose the latest authoritative snapshot, and check that capability registration does
not duplicate tools after repeated snapshot events.
