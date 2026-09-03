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
checks `document.modelContext.registerTool`. Its app-facing status starts in `checking` when the
API exists, or `unavailable` otherwise, and settles to `ready` or `attention` after registration.
`WebMcpUiStatus` exposes `phase`, availability/security hints, registered tool names, and
sanitized `{ name, message, code? }` failures; raw exceptions are never exposed to the UI.
Consumers read a defensive snapshot with `getStatus()` and receive changed snapshots through
`subscribeStatus()` (including dynamic capability changes).

It registers static tools once, subscribes to engine snapshots, and registers `interface` only
after the snapshot proves Resonance is available. Duplicate registration errors are reported in
`RegistrationReport.duplicates`, treated as usable registrations, and do not block other tools.
Pending registrations are deduplicated per tool. Disposal is idempotent: it unsubscribes from the
engine, aborts pending registrations, clears listeners/state, and ignores late success, duplicate,
or failure results. Unsupported browsers remain playable manually.

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

## Operator connection and discovery

The external gameplay agent is connected through the open browser page that exposes the native
`document.modelContext` Site tools. It is not connected through an MCP server, an MCP server
configuration file, or a second game-state service.

For the built-in Codex browser workflow, use the current ChatGPT desktop app with GPT-5.6 Sol or
GPT-5.6 Terra, not GPT-5.6 Luna. Run `npm run dev`, use `@Browser` to open
`http://127.0.0.1:5173/`, and start a new journey, continue a saved journey, or choose **Judge
Demo**. Follow that flow to the `/play` gameplay page, then inspect **Site tools** and verify
**Echo Link**. Wait for the tools to be available, then call `get_game_state` and `look_around` in
that order before taking action.

The manual local preflight is different:

1. Open `chrome://flags/#enable-webmcp-testing` in Chrome.
2. Enable the flag and relaunch Chrome.
3. Run `npm run dev` and open `http://127.0.0.1:5173/` in Chrome. From the landing page, start a
   new journey, continue a saved journey, or choose **Judge Demo** to reach `/play`.
4. Confirm the in-game Echo Link status and registered tools.

This only checks local browser/API availability. A local status, mock, or Vitest adapter test does
not establish external-agent Site-tool discovery or invocation. Hosted acceptance
must be performed separately against the deployed HTTPS page using the event-supported WebMCP
origin-trial/preview environment and a compatible external agent. This repository does not claim
that hosted verification has passed.

Browser-extension control is a separate browser-automation mechanism and is not WebMCP Site-tool
discovery.

## Runtime boundary

The integration is imperative and native: it does not create a server or a second game state.
Unsupported browsers remain fully playable through the human interface, and the app reports
sanitized WebMCP status rather than exposing raw browser exceptions.

## Verify changes

Update `apps/game/src/webmcp/index.test.ts` when tool registration or lifecycle changes. Update
tool tests when schemas, target IDs, or failure conversion changes. Confirm `get_game_state` and
`look_around` expose the latest authoritative snapshot, and check that capability registration does
not duplicate tools after repeated snapshot events.
