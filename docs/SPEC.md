# WildGent — Hackathon Implementation Specification

## 1. Purpose

This document defines the implementation constraints for the WildGent WebMCP hackathon MVP.

The coding agent should optimize for:

1. shipping a polished working entry,
2. reliable real WebMCP behavior,
3. shared human/AI state,
4. visible capability progression,
5. minimal architectural complexity.

When choosing between an elegant abstraction and a simpler implementation that satisfies the hackathon requirements, choose the simpler implementation.

---

## 2. Intended Stack

Preferred stack:

- Vite
- React 19
- Tailwind CSS 4
- raw Three.js
- TypeScript
- Effect 4 where it materially improves core domain logic
- npm workspaces / Turbo only if already present and useful
- Cloudflare deployment
- localStorage persistence

Do not introduce:
- backend APIs,
- databases,
- authentication,
- cloud save,
- analytics,
- physics engines,
- heavy game engines,
- unnecessary state libraries.

---

## 3. Repository Shape

Keep the repository small.

Suggested structure:

```text
apps/
  game/
    src/
      app/
      game/
      webmcp/
      rendering/
      ui/
      content/
      styles/

packages/
  game-engine/
    src/
      state.ts
      commands.ts
      queries.ts
      events.ts
      engine.ts
      rules/
      persistence.ts
      index.ts
```

If the monorepo adds friction, prefer a simpler single-app structure.

Static game content should be ordinary TypeScript data/modules.

Do not build repository abstractions for static scene data.

---

## 4. Game Engine Contract

The core engine should expose approximately:

```ts
dispatch(command, context)
query(query)
getSnapshot()
subscribe(listener)
reset(mode)
```

Optional:

```ts
loadCheckpoint(checkpoint)
```

The engine is the source of truth for gameplay.

React and Three.js must not own duplicate game state.

No Redux/Zustand mirror is required unless a concrete problem justifies it.

---

## 5. Minimum State Model

Use one versioned aggregate.

Suggested shape:

```text
GameState
├─ schemaVersion
├─ revision
├─ sessionMode
├─ phase
├─ currentArea
├─ player
│  ├─ position
│  ├─ facing
│  └─ discoveredTargets
├─ party
│  ├─ members
│  ├─ activeWildGent
│  └─ unlockedCapabilities
├─ world
│  ├─ relay state
│  ├─ ruin rubble state
│  ├─ terminal state
│  ├─ maintenance path discovery
│  ├─ access sigil state
│  └─ guardian state
├─ directives
│  └─ avoidBattles
├─ battle?
├─ objective
├─ checkpoint
└─ activity
```

Use an explicit phase union rather than inferring progression from many unrelated booleans.

Example phases:

```text
camp_intro
approach
voltyn_relay
voltyn_resonance
ruin_entry
maintenance_discovery
guardian
ancient_core
core_complete
```

---

## 6. Commands

Keep commands small and meaningful.

Suggested `GameCommand` union:

```text
MoveStep
MoveTo
Inspect
Interact
UseCapability
SwitchWildGent
StartBattle
BattleAction
UseBattleEnvironment
DiscoverHumanTarget
Checkpoint
Reset
```

Do not create commands such as:

```text
SolvePuzzle
CompleteQuest
WinBattle
CaptureWildGent
Teleport
SetGameState
```

The agent must play through the same rules as the human.

---

## 7. Queries

Suggested `GameQuery` union:

```text
GetPlayerState
LookAround
InspectTarget
GetParty
GetObjective
GetBattleState
GetDirectiveState
```

Queries must never reveal:
- undiscovered hidden routes,
- future puzzle solutions,
- unreached story content.

---

## 8. Action Context and Results

Every mutation should carry context.

Suggested:

```ts
type ActionContext = {
  actor: "human" | "agent" | "system"
  requestId: string
  expectedRevision?: number
}
```

Suggested result:

```ts
type ActionResult = {
  success: boolean
  code: string
  message: string
  revision: number
  data?: unknown
  events?: GameEvent[]
  nextOptions?: string[]
}
```

Use stable error codes.

Examples:

```text
BUSY
INVALID_TARGET
CAPABILITY_UNAVAILABLE
HUMAN_DISCOVERY_REQUIRED
BATTLE_BLOCKED_BY_HUMAN_DIRECTIVE
TARGET_NOT_DISCOVERED
INVALID_PHASE
```

---

## 9. Action Coordination

Do not build a command queue.

Use a simple mutation lock.

```text
idle
  ↓
accept action
  ↓
engine updates logical state
  ↓
renderer presents animation
  ↓
action completes
  ↓
idle
```

Queries may continue during presentation.

Competing mutations return `BUSY`.

The engine itself must not wait for Three.js animation completion.

Use a thin ActionCoordinator outside the engine to bridge:
- UI,
- WebMCP,
- engine,
- renderer completion.

---

## 10. Manual and WebMCP Parity

Both human UI actions and WebMCP tools must invoke the same domain actions.

Required architecture:

```text
Human UI ──┐
           ├── ActionCoordinator → GameEngine → GameState
WebMCP ────┘
```

Do not implement separate game rules for Echo.

---

## 11. WebMCP Tool Surface

Register stable tools after game state is hydrated.

Suggested tools:

```text
get_player_state
look_around
move
inspect_object
interact
get_party
switch_active_wildgent
get_battle_state
use_battle_action
use_battle_environment
```

Capability tools:

```text
ignite
break
interface
```

For the hackathon, capability registration is **additive only**.

At start:

```text
ignite
break
```

After Voltyn Resonance:

```text
interface
```

is registered.

Do not dynamically unregister capabilities when party composition changes.

The game engine must still validate capability legality on every call.

---

## 12. WebMCP Result Rules

Tool responses must be:
- concise,
- structured,
- player-safe,
- explicit about failure,
- free of hidden chain-of-thought.

A refusal should return:
- stable code,
- concise reason,
- unchanged revision,
- currently valid alternative or missing requirement.

Example:

```json
{
  "success": false,
  "code": "HUMAN_DISCOVERY_REQUIRED",
  "message": "The maintenance route has not been discovered by the player.",
  "revision": 14
}
```

Do not leak hidden object identifiers or future solutions.

---

## 13. Human-Only Discovery

The maintenance path is reserved for the human.

Implement this in game rules.

Suggested content flag:

```ts
discoveryPolicy: "humanInteractionRequired"
```

Before discovery:
- Echo cannot inspect the route,
- Echo cannot move through it,
- Echo receives `HUMAN_DISCOVERY_REQUIRED`.

After the player manually discovers it:
- shared state marks it discovered,
- Echo may inspect and use it normally.

Do not rely on assumptions about model vision.

---

## 14. Human Directive

Implement:

```text
avoidBattles: boolean
```

The human may toggle this through the manual HUD.

Echo may inspect the directive but cannot change it.

If an agent action would initiate battle while `avoidBattles` is active:

```text
BATTLE_BLOCKED_BY_HUMAN_DIRECTIVE
```

The refusal should appear in the Echo activity panel.

---

## 15. Resonance

The Judge Demo must begin before Voltyn Resonance.

Initial capabilities:

```text
ignite
break
```

After relay completion:

```text
VOLTyN RESONANCE
```

Then:
- add Voltyn to the party,
- unlock `interface`,
- register the WebMCP `interface` tool,
- emit a visible capability event,
- update Echo activity.

This is a P0 acceptance requirement.

---

## 16. Rendering

Use the simplest viable low-poly 3D architecture.

Requirements:
- raw Three.js,
- fixed authored camera,
- simple primitive geometry,
- simple lighting,
- grid or constrained navigation,
- raycasting for manual interaction,
- visibly animated movement,
- no physics,
- no skeletal rigging,
- no free camera,
- no heavy post-processing.

Prefer one small connected world with camera transitions if that is simpler than multiple isolated scene lifecycle systems.

Do not create sophisticated scene infrastructure unless the prototype proves it is needed.

---

## 17. UI

P0 UI:

### Game View
Main Three.js world.

### Party HUD
Shows:
- Cindra,
- Grum,
- Voltyn after Resonance,
- available capabilities.

### Objective
Shows the current high-level goal.

### Directive Control
Manual `Avoid battles` toggle.

### Echo Activity Rail
Shows:
- WebMCP compatibility status,
- active directives,
- tool calls,
- tool results,
- capability unlock events,
- refusals,
- visible state changes.

### Battle UI
Shows:
- participants,
- HP,
- action buttons,
- environment interaction.

Do not embed an LLM chat UI.

Conversation remains in the external agent.

---

## 18. Battle

Use deterministic turn-based rules.

Recommended minimum:

```text
Cindra: 80 HP
Grum: 110 HP
Voltyn: 85 HP
Guardian: 160 HP
Strike: 20 damage
```

Actions:
- Strike
- Defend
- Signature
- Switch
- Environment

One environmental action:
- exposed conduit,
- requires `interface`,
- fixed damage and stun.

No:
- RNG,
- critical hits,
- XP,
- levels,
- elemental chart,
- inventory combat,
- status matrix.

If schedule pressure becomes severe, simplify battle presentation before compromising the WebMCP loop.

---

## 19. Persistence

Use localStorage.

Use:

```text
schemaVersion: 1
```

Save only at meaningful checkpoints.

Suggested:
- after Voltyn Resonance,
- after ruin puzzle progress,
- before guardian,
- after guardian,
- at Ancient Core.

Validate saved data.

If incompatible or corrupt:
- reset safely.

Do not build save migrations for the hackathon.

---

## 20. Judge Demo State Machine

Target runtime:
- 90–120 seconds.

Sequence:

```text
START
  ↓
Voltyn relay
  ↓
Echo inspects relay
  ↓
BREAK
  ↓
relay restored
  ↓
VOLTyN RESONANCE
  ↓
INTERFACE registered
  ↓
player sets / confirms Avoid battles
  ↓
Echo moves to ruins
  ↓
BREAK rubble
  ↓
inspect terminal
  ↓
INTERFACE terminal
  ↓
access sigil required
  ↓
HUMAN_DISCOVERY_REQUIRED
  ↓
human discovers maintenance route
  ↓
Echo resumes
  ↓
sigil obtained
  ↓
ruin opened
  ↓
guardian appears
  ↓
BATTLE_BLOCKED_BY_HUMAN_DIRECTIVE
  ↓
END DEMO
```

The Judge Demo must use normal game rules and real WebMCP.

No scripted fake Echo behavior.

---

## 21. Manual Game Flow

Target:
- 8–12 minutes.

Suggested flow:

```text
Camp
  ↓
Cindra thermal beacon interaction
  ↓
Approach
  ↓
Voltyn relay
  ↓
Resonance
  ↓
Ruins
  ↓
Human maintenance route discovery
  ↓
Guardian battle
  ↓
Ancient Core
  ↓
UNKNOWN WILDGENT SIGNATURE DETECTED
```

---

## 22. Testing

Prioritize tests that protect the demo.

### Unit / Domain
Test:
- phase transitions,
- capability restrictions,
- human directive enforcement,
- human-only discovery,
- Resonance unlock,
- deterministic battle,
- checkpoint/reset,
- state revision behavior.

### Contract
Verify:
- manual and WebMCP actions reach the same engine path,
- stale/invalid capability calls are rejected,
- additive tool registration works,
- unsupported WebMCP API is handled cleanly.

### Gameplay acceptance

Automated coverage stays at the deterministic engine, adapter, and projection level. Before
submission, manually replay the full human happy path and Judge Demo with the built-in browser.
Real hosted WebMCP must be repeatedly tested manually with the actual supported agent/browser.

Do not spend large amounts of time testing renderer internals unless a real bug demands it.

---

## 23. Development Priority

Implement in this order:

1. Hosted WebMCP tool invocation.
2. Human and WebMCP actions mutate the same state.
3. Voltyn Resonance adds `interface`.
4. Multi-step ruin puzzle.
5. Human-only discovery.
6. Human directive blocks Echo.
7. Manual game completion.
8. Battle.
9. Visual polish.
10. Audio and decorative effects.

If the schedule slips:
- cut audio,
- cut decorative props,
- cut secondary animation,
- simplify battle presentation.

Do not cut:
- real WebMCP,
- shared state,
- capability unlock,
- human-only discovery,
- directive enforcement,
- reproducible Judge Demo.

---

## 24. P0 / P1 / Post-Hackathon

### P0
- hosted HTTPS build,
- real WebMCP,
- same engine for UI and agent,
- Cindra / Grum / Voltyn,
- `ignite` / `break` / `interface`,
- Voltyn Resonance,
- additive capability registration,
- ruin puzzle,
- human-only discovery,
- Avoid battles directive,
- Echo activity rail,
- manual completion,
- one battle,
- Ancient Core ending,
- local save/reset,
- public repository,
- open-source LICENSE,
- README,
- <3 minute demo video.

### P1
- richer animation,
- audio,
- more props,
- accessibility polish,
- better battle cinematics,
- responsive viewer improvements.

### Post-Hackathon
- Mori / Luma / Aero,
- extra areas,
- deeper Resonance,
- dynamic party-dependent unregistering,
- inventory,
- crafting,
- multiplayer,
- procedural systems,
- economy,
- full campaign.

---

## 25. Coding-Agent Guardrails

The coding agent must not:
- expand game scope without explicit approval,
- introduce enterprise abstractions “for future scalability,”
- add services/repositories solely for architectural cleanliness,
- add new libraries when ordinary TypeScript is enough,
- create separate AI game logic,
- add fake/scripted Echo,
- add hidden shortcuts for the Judge Demo,
- replace deterministic gameplay with LLM-generated game state,
- expose hidden puzzle solutions to tools.

The coding agent should:
- prefer direct readable code,
- keep domain logic deterministic,
- keep WebMCP thin,
- keep rendering separate from game truth,
- preserve the non-negotiable product principles,
- optimize for a reliable hosted demo.
