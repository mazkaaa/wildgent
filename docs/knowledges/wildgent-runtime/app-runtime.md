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

`WildGentApp` owns a small History API pathname seam. `/` renders the dedicated `LandingPage` with
a non-interactive `WorldScene` preview of the current snapshot; `/play` renders `GameApp` only when
the shared runtime has left preflight. The app keeps one `AppRuntime` and one WebMCP registration outside the route surface,
so browser Back/Forward and the Landing page's Continue journey action preserve authoritative state.
A direct `/play` visit with a preflight runtime is replaced with `/` instead of auto-starting or
showing an empty game surface. Begin journey and Start Judge Demo dispatch their explicit start
commands (resetting the saved expedition through the engine) before navigating to `/play`.
The route seam updates the document title and moves focus to the active surface; the first-run
coach owns focus when a new start request opens it.

`GameApp` requires both an `AppRuntime` and the explicit `webMcp` registration object. The shell
subscribes to WebMCP status and presents it as the Echo Link HUD control; this is a presentation
seam, not a second game state. The HUD also contains the objective rail, directive and pause
controls, party/battle state, activity-based Adventure log, and the field guide. The visible Landing
control returns to `/` without resetting. Leaving `/play` cancels queued movement, clears the
presentation sync, disposes the scene, and releases the pause lock. The guide sections cover How
to Play, Human + Echo, concise Echo Link guidance, a closed Judge and technical runbook, and
diagnostics. Party skills and Echo capabilities remain available through a collapsed native
disclosure so the world stays primary.

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

Both Begin journey and Start Judge Demo call the same versioned first-run coach. Completion or skip
persists `wildgent.guide.dismissed.v1` in browser `localStorage`, so it opens once per browser
(storage failures only remove persistence). Replay from the field guide starts it again. Opening
the coach pauses the runtime, traps focus, and restores the previous pause state and focus target
when it closes; the field guide similarly restores focus when dismissed. Pause cancels queued human
steps, blocks keyboard/canvas interaction, and makes WebMCP mutations return a structured `BUSY`
refusal while queries remain available.

## Three.js contract

`WorldScene` creates the 10 by 7 tile map,
landmark hit targets, a shared expedition marker, and camera. The selected-landmark state flows from
`GameApp` through `setSnapshot(snapshot, selectedLandmark)` / `setSelectedLandmark`; the scene uses
that seam to highlight the selected landmark and provide a smaller presentation-only camera pull,
while authoritative position still comes from the snapshot. `cameraFrameFor` keeps the authored
per-zone camera base and applies bounded horizontal pan with the player as the primary focus.
`responsiveCameraFrameFor` then adapts that presentation frame to the canvas aspect: narrow views
preserve desktop horizontal coverage by opening the vertical field of view up to a ceiling and
retreating along the target vector only if necessary. It changes neither authoritative state nor the
camera target used by pointer raycasts. The landing preview creates a second presentation-only
`WorldScene` from the same authoritative snapshot, registers no interaction callbacks, observes its
own canvas size, and disposes on route change. If WebGL creation fails, the landing page keeps its
static signal specimen.
Direct movement interpolates explicit marker and camera start/destination values on one shared eased
timeline for up to 600 ms; the presentation gate settles only after both reach their destinations.
Selection changes during travel retarget the active frame while preserving the gate promise, so the
coordinator remains locked until the latest marker and camera destination settle. Reduced motion
immediately applies the settled marker and camera frame.

`presentationCuesForTransition` derives presentation-only camera, landmark, Resonance, capability,
and battle-impact cues from snapshot transitions and activity actor metadata. The human marker stays
ember-stable; human/system/Echo activity is shown through ember/gold/cyan transient world cues.
`prefers-reduced-motion: reduce` is the boundary for presentation only: it disables interpolation,
pulsing, rotation, bobbing, and cue animation while retaining settled world state and cues. It does
not change engine rules, WebMCP behavior, or the manual interaction contract.

Gameplay remains mounted from 320px upward. The HUD progressively compacts and horizontally scrolls
landmark choices at narrow widths, but keyboard and mouse remain the manual control contract; no
touch movement control is registered.
