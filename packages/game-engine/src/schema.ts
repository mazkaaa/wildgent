import { Schema } from "effect";
import {
  CAPABILITIES,
  DIRECTIVES,
  DISCOVERIES,
  GAME_MODES,
  type GameSnapshot,
  GRID_HEIGHT,
  GRID_WIDTH,
  PHASES,
  SAVE_SCHEMA_VERSION,
  SCENES,
  WILD_GENTS,
} from "./types";

const capabilitySchema = Schema.Literals([
  CAPABILITIES.IGNITE,
  CAPABILITIES.BREAK,
  CAPABILITIES.INTERFACE,
]);

const memberSchema = Schema.Struct({
  id: Schema.Literals([WILD_GENTS.CINDRA, WILD_GENTS.GRUM, WILD_GENTS.VOLTYN]),
  name: Schema.String,
  role: Schema.Literals(["starter", "resonant"]),
  capabilities: Schema.Array(capabilitySchema),
  maxHp: Schema.Number,
  hp: Schema.Number,
  attack: Schema.Number,
  signatureDamage: Schema.Number,
  signatureUsed: Schema.Boolean,
  active: Schema.Boolean,
});

const relaySchema = Schema.Struct({
  damaged: Schema.Boolean,
  housingCleared: Schema.Boolean,
  energyCellCharged: Schema.Boolean,
  aligned: Schema.Boolean,
  restored: Schema.Boolean,
});

const puzzleSchema = Schema.Struct({
  rubbleCleared: Schema.Boolean,
  powerRestored: Schema.Boolean,
  doorInspected: Schema.Boolean,
  accessSigilRequired: Schema.Boolean,
  maintenancePathDiscovered: Schema.Boolean,
  doorOpened: Schema.Boolean,
  order: Schema.Array(Schema.String),
});

const discoverySchema = Schema.Struct({
  id: Schema.Literals([DISCOVERIES.MAINTENANCE_PATH, DISCOVERIES.CYAN_SIGNAL]),
  discovered: Schema.Boolean,
  discoveryPolicy: Schema.Literal("humanInteractionRequired"),
  sharedWithAgent: Schema.Boolean,
});

const directiveSchema = Schema.Struct({
  avoidBattles: Schema.Boolean,
  active: Schema.Array(Schema.Literal(DIRECTIVES.AVOID_BATTLES)),
  humanOwned: Schema.Array(Schema.Literal(DIRECTIVES.AVOID_BATTLES)),
});

const positionSchema = Schema.Struct({
  x: Schema.Int,
  y: Schema.Int,
});

/** Runtime schema for the version-2 persisted aggregate. */
export const GameSnapshotSchema = Schema.Struct({
  schemaVersion: Schema.Literal(SAVE_SCHEMA_VERSION),
  version: Schema.Number,
  mode: Schema.Literals([GAME_MODES.NEW_JOURNEY, GAME_MODES.JUDGE_DEMO]),
  phase: Schema.Literals([
    PHASES.CAMP,
    PHASES.RELAY,
    PHASES.RUINS,
    PHASES.BATTLE,
    PHASES.CORE,
    PHASES.COMPLETE,
  ]),
  scene: Schema.Literals([SCENES.CAMP, SCENES.RELAY, SCENES.RUINS, SCENES.CORE]),
  currentScene: Schema.Literals([SCENES.CAMP, SCENES.RELAY, SCENES.RUINS, SCENES.CORE]),
  location: Schema.Literals([SCENES.CAMP, SCENES.RELAY, SCENES.RUINS, SCENES.CORE]),
  position: positionSchema,
  party: Schema.Array(memberSchema),
  partyIds: Schema.Array(Schema.Literals([WILD_GENTS.CINDRA, WILD_GENTS.GRUM, WILD_GENTS.VOLTYN])),
  activeWildGentId: Schema.Literals([WILD_GENTS.CINDRA, WILD_GENTS.GRUM, WILD_GENTS.VOLTYN]),
  capabilities: Schema.Array(capabilitySchema),
  unlockedCapabilities: Schema.Array(capabilitySchema),
  relay: relaySchema,
  resonance: Schema.Struct({
    occurred: Schema.Boolean,
    wildGentId: Schema.NullOr(Schema.Literal(WILD_GENTS.VOLTYN)),
    unlockedCapability: Schema.NullOr(Schema.Literal(CAPABILITIES.INTERFACE)),
  }),
  beaconLit: Schema.Boolean,
  voltynResonance: Schema.Boolean,
  puzzle: puzzleSchema,
  discoveries: Schema.Array(discoverySchema),
  sharedDiscoveries: Schema.Array(
    Schema.Literals([DISCOVERIES.MAINTENANCE_PATH, DISCOVERIES.CYAN_SIGNAL]),
  ),
  directives: directiveSchema,
  humanDirectives: Schema.Array(Schema.Literal(DIRECTIVES.AVOID_BATTLES)),
  visibleTargets: Schema.Array(Schema.Unknown),
  battle: Schema.NullOr(Schema.Unknown),
  ancientCoreClaimed: Schema.Boolean,
  completed: Schema.Boolean,
  activity: Schema.Array(Schema.Unknown),
  checkpoint: Schema.Unknown,
});

export type GameSnapshotEncoded = Schema.Codec.Encoded<typeof GameSnapshotSchema>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const legacyPosition = (snapshot: Record<string, unknown>) => {
  const phase = snapshot.phase;
  const location = snapshot.location ?? snapshot.currentScene ?? snapshot.scene;
  const battle = isRecord(snapshot.battle) ? snapshot.battle : null;
  const locationKey =
    typeof location === "string"
      ? location
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, "_")
      : "";
  if (
    phase === PHASES.COMPLETE ||
    snapshot.completed === true ||
    snapshot.ancientCoreClaimed === true ||
    battle?.status === "won"
  ) {
    return { x: 4, y: 4 };
  }
  if (phase === PHASES.BATTLE || locationKey === SCENES.CORE || phase === PHASES.CORE) {
    return { x: 7, y: 4 };
  }
  if (
    locationKey === SCENES.RELAY ||
    locationKey === "facility" ||
    locationKey === "voltyn_relay" ||
    locationKey === "voltyn_relay_room" ||
    locationKey === "voltyn"
  ) {
    return { x: 5, y: 2 };
  }
  return { x: 1, y: 1 };
};

/**
 * Convert a version-1 persisted aggregate without mutating the caller's value. Nested checkpoint
 * snapshots are migrated recursively so a checkpoint remains restorable after the save bump.
 */
export const migrateSnapshot = (value: unknown): unknown => {
  if (!isRecord(value)) return value;

  const checkpoint = isRecord(value.checkpoint) ? value.checkpoint : null;
  const migratedCheckpoint =
    checkpoint === null || !Object.hasOwn(checkpoint, "snapshot")
      ? value.checkpoint
      : {
          ...checkpoint,
          snapshot:
            checkpoint.snapshot === null || checkpoint.snapshot === undefined
              ? checkpoint.snapshot
              : migrateSnapshot(checkpoint.snapshot),
        };

  if (value.schemaVersion !== 1) {
    return checkpoint === null || migratedCheckpoint === value.checkpoint
      ? value
      : { ...value, checkpoint: migratedCheckpoint };
  }

  return {
    ...value,
    schemaVersion: SAVE_SCHEMA_VERSION,
    position: legacyPosition(value),
    ...(checkpoint === null || migratedCheckpoint === value.checkpoint
      ? {}
      : { checkpoint: migratedCheckpoint }),
  };
};

/**
 * Save validation deliberately rejects unknown versions and malformed roots.
 * The rest of the shape is checked by the schema before a save is restored.
 */
export const decodeSnapshot = (value: unknown): GameSnapshot | null => {
  try {
    const decoded = Schema.decodeUnknownSync(GameSnapshotSchema)(
      migrateSnapshot(value),
    ) as GameSnapshot;
    if (
      !Number.isInteger(decoded.position.x) ||
      !Number.isInteger(decoded.position.y) ||
      decoded.position.x < 0 ||
      decoded.position.x >= GRID_WIDTH ||
      decoded.position.y < 0 ||
      decoded.position.y >= GRID_HEIGHT
    ) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
};
