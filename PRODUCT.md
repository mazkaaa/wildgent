# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Hackathon judges and players experiencing a short desktop adventure with an external AI companion.
They should understand the human-and-AI cooperation by playing, not by reading technical panels.

## Product Purpose

WildGent is a creature-collecting cooperative adventure where the human and Echo share one
authoritative world. The current chapter must deliver 8–12 minutes of polished manual gameplay and
a reproducible 90–120 second Judge Demo from camp through the Ancient Core.

## Positioning

WildGents unlock shared world capabilities. Human and AI have complementary authority: Echo can
reason and act through WebMCP, while human-only discovery and directives remain genuinely binding.

## Operating Context

The game runs in a desktop browser with keyboard and mouse. Conversation with Echo remains in the
supported external agent. The hosted build requires HTTPS and a supported WebMCP environment.

## Capabilities and Constraints

- Raw Three.js world with a fixed authored camera, constrained movement, raycast interaction, and
  visible action presentation.
- React supplies a layered game HUD; Effect owns all rules and state.
- Manual controls and WebMCP use the same command path.
- Preserve `HUMAN_DISCOVERY_REQUIRED`, `DIRECTIVE_BLOCKED`, dynamic `interface` registration,
  persistence, checkpoints, and the current chapter content.
- Desktop gameplay is supported at 1024px and wider; smaller screens receive a deliberate desktop
  requirement screen.
- Exact WebMCP telemetry is opt-in diagnostics, not normal game presentation.

## Brand Commitments

WildGent: The Living Signal. Verdant reclaimed wilderness, solarpunk ruins, mysterious technology,
colorful low-poly forms, mineral parchment, ember orange, and cyan signal energy.

## Evidence on Hand

The repository contains the complete deterministic chapter, low-poly procedural Three.js world,
manual controls, battle, WebMCP adapter, Judge Demo fixture, and automated tests. No external art,
audio, or commercial assets are available and none should be fabricated as proof.

## Product Principles

- The world is the product; HUD and WebMCP support it rather than competing with it.
- Every accepted action visibly affects the shared world.
- Human and Echo remain mutually necessary.
- Game-language feedback leads; technical diagnostics stay optional.
- Polish the complete current chapter before adding breadth.

## Accessibility & Inclusion

Keyboard operation, visible focus, sufficient contrast, reduced-motion behavior, and non-color-only
status communication are required.
