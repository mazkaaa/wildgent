# WildGent App Runtime and Presentation

## Owning code

- `apps/game/src/app.tsx` — React shell, HUD, keyboard/pointer intent, objective rail, and battle
  controls.
- `apps/game/src/app-model.ts` — presentation projection, landmark model, action resolver, and
  progression-aware objectives.
- `apps/game/src/engine-adapter.ts` — package discovery, command mapping, `ActionCoordinator`, and
  the engine/presentation seam.
- `apps/game/src/app-runtime.ts` — shared runtime exposed to React and WebMCP.
- `apps/game/src/rendering/world-scene.ts` — raw Three.js map, marker, camera, and pointer raycasts.

## Runtime flow

`createAppRuntime` constructs one `EngineAdapter` and one `ActionCoordinator`. React subscribes to
normalized snapshots and busy state. WebMCP receives the structural `gameEnginePort`, which routes
mutations through the same coordinator. The raw engine is not duplicated in React or Three.js.

Regular UI and WebMCP mutations use `dispatch`/`dispatchCommand`. Physical WASD and arrow presses
use `enqueueHumanStep`, an unbounded FIFO that ignores `KeyboardEvent.repeat`, applies each step to
the latest snapshot, and keeps `isBusy` true until the queue drains. A failed item preserves later
domain-refusal items; thrown engine/presentation failures cancel the remainder. Teardown calls
`cancelQueuedSteps` before detaching presentation.

## Landmark and objective behavior

`resolveLandmarkAction` returns `locked`, `approach`, `ready`, or `complete` plus target coordinate,
label, and hint. Exact zone and coordinate equality are required for `ready`; the engine remains
the final authority for stale callers. Vines become complete after human discovery, while the
follow-up door action belongs to the ruins sigil and requires returning to its coordinate.

`getObjectiveState` selects beacon, Resonance, travel, rubble, power, sigil, human discovery,
return-to-sigil, guardian, core, battle, or completion in progression order. Judge Demo therefore
opens with the Resonance objective even though the relay is the current scene.

## Three.js contract

`WorldScene` is mounted only after gameplay leaves preflight. It creates the 10 by 7 tile map,
landmark hit targets, a shared expedition marker, and camera. `setSnapshot` derives marker placement
only from authoritative position. Direct movement interpolates for up to 600 ms, settles a promise
when marker/camera presentation catches up, and snaps immediately for reduced motion. The human
marker remains ember-stable; actor and capability differences appear through transient world cues.
