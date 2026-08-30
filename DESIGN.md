# WildGent Visual System

## Direction

WildGent is a full-screen low-poly expedition, not a dashboard around a map. The Three.js world
occupies the viewport and carries the story. A sparse field-instrument HUD floats at its edges and
recedes whenever the player is moving or a major world event is playing.

## Visual World

- Reclaimed wilderness and solarpunk field equipment rendered as colorful faceted geometry.
- Deep forest shadows, moss and fern midtones, mineral parchment text, ember human actions, cyan
  Echo/signal actions, and restrained sun-gold highlights.
- Serif display typography for story and place; clean sans for player controls; monospace only for
  coordinates or diagnostics hidden in the debug drawer.
- HUD surfaces use dark mineral translucency only where legibility requires it. Avoid dashboard
  cards, boxed grids, persistent borders, and ornamental glass.

## Game Composition

- Full-bleed world canvas with fixed elevated authored camera and smooth zone transitions.
- Objective at top-left; directive and pause controls at top-right; party at bottom-left; contextual
  interaction prompt at bottom-center; collapsed adventure-log handle at the right edge.
- Temporary notifications appear near the upper center and never cover the controlled character or
  active landmark.
- Battle stays in-world: guardian health above, party/action HUD below, world unobscured.

## Feedback and Motion

- Human actions use ember accents; Echo and capability actions use cyan; system/objective events use
  parchment or gold. Never rely on color alone.
- Routine movement remains quiet. Discovery, refusal, capability unlock, battle impact, and chapter
  completion receive progressively stronger presentation.
- Resonance is the signature moment: the world briefly quiets, Voltyn and the relay synchronize,
  cyan energy connects party and ruin technology, and `interface` joins the capability HUD.
- Motion is interruptible, coordinated with authoritative actions, and resolves immediately under
  reduced-motion preferences.

## HUD Grammar

- Controls are compact, game-native plates with authored SVG icons or clear text labels.
- Objective copy is one immediate goal plus an optional detail; the full route is never permanently
  visible.
- Adventure events use narrative language. Raw commands, codes, actors, and timestamps appear only
  in the debug drawer.
- Focus, hover, disabled, busy, refusal, success, and unavailable states must remain distinct.

## Responsive Boundary

Desktop gameplay begins at 1024px. Smaller viewports show a polished static expedition view that
explains keyboard-and-mouse requirements; do not compress the complete HUD into mobile cards.
