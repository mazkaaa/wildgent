import {
  CAPABILITIES,
  DIRECTIVES,
  DISCOVERIES,
  GAME_MODES,
  type GameMode,
  type GameSnapshot,
  PHASES,
  SAVE_SCHEMA_VERSION,
  SCENES,
  WILD_GENTS,
} from "./types";

const starterParty = () => [
  {
    id: WILD_GENTS.CINDRA,
    name: "Cindra",
    role: "starter" as const,
    capabilities: [CAPABILITIES.IGNITE] as const,
    maxHp: 18,
    hp: 18,
    attack: 3,
    signatureDamage: 5,
    signatureUsed: false,
    active: true,
  },
  {
    id: WILD_GENTS.GRUM,
    name: "Grum",
    role: "starter" as const,
    capabilities: [CAPABILITIES.BREAK] as const,
    maxHp: 22,
    hp: 22,
    attack: 2,
    signatureDamage: 4,
    signatureUsed: false,
    active: false,
  },
];

const baseSnapshot = (mode: GameMode): GameSnapshot => ({
  schemaVersion: SAVE_SCHEMA_VERSION,
  version: 0,
  mode,
  phase: PHASES.CAMP,
  scene: SCENES.CAMP,
  currentScene: SCENES.CAMP,
  location: SCENES.CAMP,
  position: { x: 1, y: 1 },
  party: starterParty(),
  partyIds: [WILD_GENTS.CINDRA, WILD_GENTS.GRUM],
  activeWildGentId: WILD_GENTS.CINDRA,
  capabilities: [CAPABILITIES.IGNITE, CAPABILITIES.BREAK],
  unlockedCapabilities: [CAPABILITIES.IGNITE, CAPABILITIES.BREAK],
  relay: {
    damaged: true,
    housingCleared: false,
    energyCellCharged: false,
    aligned: false,
    restored: false,
  },
  resonance: {
    occurred: false,
    wildGentId: null,
    unlockedCapability: null,
  },
  beaconLit: false,
  voltynResonance: false,
  puzzle: {
    rubbleCleared: false,
    powerRestored: false,
    doorInspected: false,
    accessSigilRequired: false,
    maintenancePathDiscovered: false,
    doorOpened: false,
    order: [],
  },
  discoveries: [
    {
      id: DISCOVERIES.MAINTENANCE_PATH,
      discovered: false,
      discoveryPolicy: "humanInteractionRequired",
      sharedWithAgent: false,
    },
    {
      id: DISCOVERIES.CYAN_SIGNAL,
      discovered: false,
      discoveryPolicy: "humanInteractionRequired",
      sharedWithAgent: false,
    },
  ],
  sharedDiscoveries: [],
  directives: {
    avoidBattles: false,
    active: [],
    humanOwned: [DIRECTIVES.AVOID_BATTLES],
  },
  humanDirectives: [],
  visibleTargets: [],
  battle: null,
  ancientCoreClaimed: false,
  completed: false,
  activity: [],
  checkpoint: {
    available: true,
    label: "start",
    snapshot: null,
  },
});

/** New Journey begins at the camp, before any relay work. */
export const createNewJourneySnapshot = (): GameSnapshot => baseSnapshot(GAME_MODES.NEW_JOURNEY);

/**
 * Judge Demo is a real checkpoint at the damaged relay. It intentionally
 * starts before Voltyn Resonance so the capability unlock remains visible.
 */
export const createJudgeDemoSnapshot = (): GameSnapshot => ({
  ...baseSnapshot(GAME_MODES.JUDGE_DEMO),
  phase: PHASES.RELAY,
  scene: SCENES.RELAY,
  currentScene: SCENES.RELAY,
  location: SCENES.RELAY,
  position: { x: 5, y: 2 },
  beaconLit: true,
});

export const createFixture = (
  mode: GameMode | "newJourney" | "judgeDemo" = GAME_MODES.NEW_JOURNEY,
): GameSnapshot =>
  mode === GAME_MODES.JUDGE_DEMO || mode === "judgeDemo"
    ? createJudgeDemoSnapshot()
    : createNewJourneySnapshot();
