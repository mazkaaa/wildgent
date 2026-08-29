# WildGent Engine and Persistence

## Owning code

- `packages/game-engine/src/engine.ts` — `WildGentGameEngine`, transitions, queries, commits, and
  reset behavior.
- `packages/game-engine/src/types.ts` — command, snapshot, result, query, battle, and persistence
  contracts.
- `packages/game-engine/src/schema.ts` — version-2 runtime validation and version-1 migration.
- `packages/game-engine/src/fixtures.ts` — New Journey and Judge Demo snapshots.
- `packages/game-engine/src/failures.ts` — Effect tagged failure values and failure factory.

## Aggregate and grid

`GameSnapshot` is versioned with `schemaVersion: 2` and includes phase, scene/location, party,
capabilities, relay, resonance, ruin puzzle, discoveries, directives, visible targets, battle,
activity, checkpoint, completion flags, and authoritative `position`. The movement grid is 10 by
7 with integer coordinates from `(0,0)` through `(9,6)`.

Canonical fixture and transition positions are `(1,1)` for camp, `(5,2)` for the relay, `(2,2)`
for rubble, `(5,3)` for power, `(7,6)` for the ruin door, `(8,2)` for the maintenance signal,
`(7,4)` for the guardian entry, and `(4,4)` for the Ancient Core.

## Commands and queries

`dispatch`/`dispatchSync` accept normalized variants of start, move, step, direct position move,
inspect, capability, discovery, directive, battle, door, and core commands. `STEP` and
`MOVE_TO_POSITION` are human-only. `MOVE` accepts available routes or visible/discovered targets.
Queries include state, phase, location, world/look-around, targets, capabilities, party, relay,
resonance, puzzle, discoveries, directives, battle, activity, and `can` checks.

## Refusals and persistence

The engine preserves position on refusals such as `INVALID_POSITION`, `OUT_OF_RANGE`,
`INVALID_CONTEXT`, `TARGET_NOT_FOUND`, `HUMAN_DISCOVERY_REQUIRED`, route gating, capability
requirements, and battle/directive rules. Every transition commits an activity event, increments
version, notifies subscribers, and attempts persistence. The default storage key is
`wildgent.game.snapshot.v1`; schema version and storage key are intentionally independent.

Local storage is wrapped defensively and falls back to an isolated in-memory adapter when browser
storage is unavailable. Valid version-1 snapshots, including nested checkpoints, gain a derived
position during migration. Malformed or incompatible saves are ignored and a safe fixture is used.

## Checkpoints

The engine stores a checkpoint snapshot and labels it `start`, `resonance`, `discovery`, `battle`,
or `complete`. `reset("checkpoint")` restores the latest checkpoint; clean reset also clears the
configured persistence adapter. Do not mutate snapshots returned by `getSnapshot`; they are cloned.
