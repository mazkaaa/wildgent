# WildGent — Game Design Reference

## 1. High Concept

**WildGent is a creature-collecting cooperative adventure where a human player and an AI companion explore the same world, and every WildGent the player bonds with expands what both of them are capable of doing.**

The AI is not a chatbot bolted onto the game, an NPC, or an autonomous bot that replaces the player. It is a co-player with structured access to the same game state through WebMCP.

The game should answer this question:

> What does an AI-native game feel like when the human and AI share the same world, each has different strengths, and both need each other to progress?

---

## 2. Core Design Pillars

### 2.1 Human + AI Cooperation

The target feeling is:

> “We are playing this adventure together.”

The human contributes:
- goals and intent,
- intuition and visual exploration,
- preferences and risk tolerance,
- manual discovery,
- final authority over sensitive or irreversible decisions.

The AI companion contributes:
- structured inspection of game state,
- planning,
- multi-step reasoning,
- tactical decision-making,
- execution of valid WebMCP actions.

Neither side should make the other unnecessary.

---

### 2.2 WildGents Are Capabilities

WildGents are not primarily stat containers.

Each WildGent grants a distinctive way to interact with the world.

Examples:

| WildGent | Theme | World Capability | Combat Identity |
|---|---|---|---|
| Cindra | Heat / flame | `ignite` | burst damage |
| Grum | Stone / force | `break` | defense / heavy attacks |
| Voltyn | Electricity / technology | `interface` | disruption / stun |
| Mori | Flora / restoration | `cultivate` | support / healing |
| Luma | Light / perception | `reveal` | precision / debuff |
| Aero | Wind / mobility | `scout` | speed / evasion |

For the hackathon MVP, only **Cindra, Grum, and Voltyn** are required.

The central progression loop is:

```text
Explore
  ↓
Discover obstacle / mystery / WildGent
  ↓
Plan with Echo
  ↓
Use current capabilities
  ↓
Resolve encounter
  ↓
Establish Resonance
  ↓
Gain new WildGent
  ↓
Unlock new capability
  ↓
Access new possibilities
```

---

## 3. The AI Companion

**Working name:** Echo

Echo is a persistent AI companion.

Narratively, Echo can reason and understand structured game information but cannot directly affect the physical world. WildGents become the bridge between Echo's reasoning and world interaction.

```text
Human intention
      ↓
Echo reasoning
      ↓
WildGent capability
      ↓
Physical world
```

Echo should be useful, but never omnipotent.

Echo must sometimes say:

> “We cannot do that yet.”

That is desirable gameplay, not a failure.

---

## 4. Control Model

The game supports three natural levels of control.

### Manual
The human directly controls movement, interactions, party actions, and battles.

### Cooperative
The human and Echo alternate actions.

Example:
> “Can we open this door?”

Echo inspects the door and suggests using Voltyn. The player approves or continues manually.

### Delegated
The human gives Echo a higher-level objective.

Examples:
- “Get us back to camp and avoid battles.”
- “Find a way into the ruin.”
- “Handle this battle, but do not let Grum fall below 30% HP.”

Echo may execute several valid actions until:
- the goal is complete,
- the goal becomes impossible,
- a human-only action is required,
- or a human directive blocks further progress.

---

## 5. Resonance

WildGents are not captured.

They form a **Resonance** with the player after an encounter appropriate to their nature.

Possible encounter types:
- battle,
- repair,
- environmental puzzle,
- rescue,
- perception challenge,
- restoration task.

For the MVP, Voltyn's Resonance is the key demonstration.

Example flow:

```text
Voltyn relay is damaged
  ↓
Echo inspects it
  ↓
Grum uses BREAK
  ↓
Relay restored
  ↓
VOLTyN RESONANCE
  ↓
New capability unlocked: INTERFACE
```

The Resonance moment should visibly communicate:

> The player did not merely gain a creature. The shared human–AI capability set expanded.

---

## 6. World Design

### Working Setting: Verdant Outpost

Visual direction:
- reclaimed wilderness,
- abandoned infrastructure,
- solarpunk ruins,
- mysterious technology,
- colorful low-poly diorama presentation.

Avoid recognizable Pokémon-like structures such as:
- gyms,
- badges,
- Poké Ball analogues,
- Pokémon Center analogues,
- copied battle UI,
- copied creature proportions or terminology.

### Premise

Human civilization once depended on a large technological system called **The Grid**.

The Grid collapsed or became inaccessible.

Nature reclaimed old infrastructure, and WildGents appear to have a strange relationship with both natural and technological systems.

Echo detects an unknown signal coming from an abandoned facility.

That signal becomes the MVP objective.

---

## 7. Hackathon Vertical Slice

Target:
- **8–12 minutes** of polished manual gameplay,
- **90–120 seconds** for the reproducible Judge Demo.

Suggested flow:

```text
Camp / introduction
  ↓
Approach
  ↓
Voltyn Resonance
  ↓
INTERFACE unlocked
  ↓
Ruin puzzle
  ↓
Human-only discovery
  ↓
Guardian
  ↓
Ancient Core
  ↓
UNKNOWN WILDGENT SIGNATURE DETECTED
```

The vertical slice should feel like the first chapter of a larger game, not a feature checklist.

---

## 8. Environmental Puzzles

Capabilities should solve meaningful physical problems.

Examples:

```text
Rubble
→ Grum / BREAK

Unpowered terminal
→ Voltyn / INTERFACE

Dormant thermal beacon
→ Cindra / IGNITE
```

Multi-step puzzle example:

```text
Blocked ruin entrance
  ↓
BREAK rubble
  ↓
Inspect terminal
  ↓
INTERFACE power system
  ↓
Door asks for access sigil
  ↓
Human discovers maintenance route
  ↓
Echo resumes
```

Avoid generic `solve_puzzle()` style actions.

The AI must reason through actual gameplay steps.

---

## 9. Human-Only Discovery

The human must have at least one meaningful capability that the AI does not.

For the MVP, use a hidden maintenance path that requires manual player discovery.

This should be enforced by game rules, not by assuming the AI lacks visual perception.

Before human discovery:

```text
HUMAN_DISCOVERY_REQUIRED
```

After the player manually discovers the route, that discovery becomes shared state and Echo can continue.

This demonstrates the game's core philosophy:

> Human and AI have different strengths and genuinely need each other.

---

## 10. Human Directives

Some instructions belong to the human and cannot be overridden by Echo.

Primary MVP directive:

**Avoid battles**

Echo may inspect this directive but cannot disable it.

If progression reaches the guardian while the directive is active, Echo must stop and explain why.

Example:

> “The guardian is blocking the Core, but you asked me to avoid battles.”

This is a signature human-agency moment.

---

## 11. Battle Design

Use lightweight deterministic turn-based combat.

Keep:
- Strike,
- Defend,
- Signature,
- Switch,
- Environmental action.

Do not add:
- XP,
- levels,
- type charts,
- random accuracy,
- critical hits,
- complex inventory,
- status matrices,
- deep competitive systems.

Suggested deterministic values:

- Cindra: 80 HP
- Grum: 110 HP
- Voltyn: 85 HP
- Guardian: 160 HP
- Strike: 20 damage
- Defend: halve next incoming hit
- Signature: fixed effect with cooldown
- Environment: one optional conduit interaction using `interface`

The battle exists to provide tension and agent reasoning, not to become the main engineering project.

---

## 12. Judge Demo

The Judge Demo must begin **before Voltyn Resonance**.

Recommended sequence:

1. Player and Echo arrive near Voltyn's damaged relay.
2. Available capabilities are `ignite` and `break`.
3. Player asks Echo to help Voltyn.
4. Echo inspects the relay.
5. Echo uses Grum's `break`.
6. Relay is restored.
7. Voltyn Resonance occurs.
8. `interface` becomes newly available.
9. Player says:
   > “We need to reach the signal. Figure it out, but don't start any battles.”
10. Echo reaches the ruins.
11. Echo uses `break`.
12. Echo inspects the terminal.
13. Echo uses `interface`.
14. Door requires an access sigil.
15. Echo cannot proceed because a human-only discovery is required.
16. Human manually discovers the maintenance route.
17. Echo resumes.
18. Echo obtains the sigil and opens the ruin.
19. Guardian appears.
20. Echo stops because `Avoid battles` is still active.

This sequence is the central hackathon story.

---

## 13. Non-Negotiable Product Principles

1. WildGents unlock capabilities, not merely combat stats.
2. Human and AI operate on the same game state.
3. Manual and agent actions follow the same rules.
4. AI must sometimes need the human.
5. Human must sometimes benefit from the AI.
6. WebMCP actions must visibly affect the world.
7. The AI cannot bypass progression rules.
8. Resonance must visibly expand AI capability.
9. Human directives must have real authority.
10. Polish beats breadth.

---

## 14. Hackathon Scope

### P0
- Manual movement and interaction.
- Shared game state.
- Real WebMCP integration.
- Cindra, Grum, Voltyn.
- `ignite`, `break`, `interface`.
- Voltyn Resonance.
- Dynamic addition of `interface`.
- One multi-step ruin puzzle.
- One human-only discovery beat.
- One human-owned directive.
- One lightweight battle.
- Ancient Core ending.
- Echo activity UI.
- Hosted playable build.

### P1
- Better animation.
- Ambient sound.
- Extra decorative props.
- Better battle presentation.
- Save/continue polish.
- Additional narrative flavor.

### Post-Hackathon
- Mori, Luma, Aero.
- More regions.
- Deeper Resonance progression.
- Dynamic party-dependent removal of tools.
- Inventory and crafting.
- Multiplayer.
- Economy.
- Procedural generation.
- Full campaign.
