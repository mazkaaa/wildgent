import type { Effect as EffectType } from "effect/Effect";

/** The current save format understood by the hackathon engine. */
export const SAVE_SCHEMA_VERSION = 2 as const;
export type SaveSchemaVersion = typeof SAVE_SCHEMA_VERSION;

export const GRID_WIDTH = 10 as const;
export const GRID_HEIGHT = 7 as const;

export interface GridPosition {
  readonly x: number;
  readonly y: number;
}

export type CardinalDirection = "north" | "south" | "east" | "west";

export const GAME_MODES = {
  NEW_JOURNEY: "new-journey",
  JUDGE_DEMO: "judge-demo",
} as const;
export type GameMode = (typeof GAME_MODES)[keyof typeof GAME_MODES];

export const RESET_MODES = {
  NEW_JOURNEY: "new-journey",
  JUDGE_DEMO: "judge-demo",
  CHECKPOINT: "checkpoint",
  CLEAN: "clean",
} as const;
export type ResetMode = GameMode | "checkpoint" | "clean" | "newJourney" | "judgeDemo";

export const PHASES = {
  CAMP: "camp",
  RELAY: "relay",
  RUINS: "ruins",
  BATTLE: "battle",
  CORE: "core",
  COMPLETE: "complete",
} as const;
export type GamePhase = (typeof PHASES)[keyof typeof PHASES];

export const SCENES = {
  CAMP: "camp",
  RELAY: "relay",
  RUINS: "ruins",
  CORE: "core",
} as const;
export type SceneId = (typeof SCENES)[keyof typeof SCENES];
export type LocationId = SceneId;

export const CAPABILITIES = {
  IGNITE: "ignite",
  BREAK: "break",
  INTERFACE: "interface",
} as const;
export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

export const WILD_GENTS = {
  CINDRA: "cindra",
  GRUM: "grum",
  VOLTYN: "voltyn",
  WARPED_GUARDIAN: "warped-guardian",
} as const;
export type WildGentId = (typeof WILD_GENTS)[keyof typeof WILD_GENTS];

export const DIRECTIVES = {
  AVOID_BATTLES: "avoid-battles",
} as const;
export type DirectiveId = (typeof DIRECTIVES)[keyof typeof DIRECTIVES];

export const DISCOVERIES = {
  MAINTENANCE_PATH: "maintenance-path",
  CYAN_SIGNAL: "cyan-signal",
} as const;
export type DiscoveryId = (typeof DISCOVERIES)[keyof typeof DISCOVERIES];

export const DISCOVERY_POLICIES = {
  HUMAN_INTERACTION_REQUIRED: "humanInteractionRequired",
} as const;

export type CommandActor = "human" | "agent" | "echo" | "player" | "system";

/** Metadata supplied by the manual UI or by the external WebMCP adapter. */
export interface CommandContext {
  readonly actor?: CommandActor;
  readonly source?: "manual" | "webmcp" | "human" | "agent" | "system";
  readonly requestId?: string;
  /** The presentation coordinator can mark a mutation as active. */
  readonly mutationState?: "idle" | "active";
  readonly wildGentId?: WildGentId;
}

export type TargetId = string;

export interface CommandBase {
  readonly type: string;
  readonly targetId?: TargetId;
  readonly target?: TargetId;
  readonly locationId?: LocationId | string;
  readonly direction?: CardinalDirection | string;
  readonly position?: GridPosition;
  readonly actorId?: WildGentId;
  readonly wildGentId?: WildGentId;
  readonly capability?: Capability | string;
  readonly action?: BattleAction | string;
  readonly directive?: DirectiveId | string;
  readonly active?: boolean;
}

/**
 * Commands intentionally stay small. The string fallback keeps the runtime
 * able to return a structured INVALID_COMMAND result for malformed WebMCP
 * input without making the adapter cast unknown JSON to `never`.
 */
export type GameCommand =
  | (CommandBase & {
      readonly type:
        | "NEW_JOURNEY"
        | "new-journey"
        | "newJourney"
        | "START_JOURNEY"
        | "start_journey"
        | "START"
        | "start";
    })
  | (CommandBase & {
      readonly type: "MOVE" | "move" | "TRAVEL" | "travel" | "ENTER" | "enter";
    })
  | (CommandBase & {
      readonly type: "STEP" | "step";
    })
  | (CommandBase & {
      readonly type: "MOVE_TO_POSITION" | "move_to_position" | "moveToPosition";
    })
  | (CommandBase & {
      readonly type: "INSPECT" | "inspect" | "LOOK" | "look";
    })
  | (CommandBase & {
      readonly type: "USE_CAPABILITY" | "use_capability" | "useCapability" | "CAPABILITY";
    })
  | (CommandBase & {
      readonly type: "IGNITE" | "ignite" | "BREAK" | "break" | "INTERFACE" | "interface";
    })
  | (CommandBase & {
      readonly type:
        | "DISCOVER"
        | "discover"
        | "DISCOVER_MAINTENANCE_PATH"
        | "discover_maintenance_path"
        | "discoverMaintenancePath";
    })
  | (CommandBase & {
      readonly type:
        | "SET_DIRECTIVE"
        | "set_directive"
        | "setDirective"
        | "AVOID_BATTLES"
        | "avoid_battles"
        | "avoidBattles";
    })
  | (CommandBase & {
      readonly type: "START_BATTLE" | "start_battle" | "startBattle" | "FIGHT" | "fight";
    })
  | (CommandBase & {
      readonly type:
        | "BATTLE_ACTION"
        | "battle_action"
        | "battleAction"
        | "STRIKE"
        | "strike"
        | "DEFEND"
        | "defend"
        | "SIGNATURE"
        | "signature"
        | "SWITCH"
        | "switch"
        | "ENVIRONMENTAL"
        | "environmental";
    })
  | (CommandBase & {
      readonly type: "OPEN_DOOR" | "open_door" | "openDoor" | "OPEN" | "open";
    })
  | (CommandBase & {
      readonly type: "CLAIM_CORE" | "claim_core" | "claimCore" | "COMPLETE" | "complete";
    })
  | (CommandBase & { readonly type: string });

export const BATTLE_ACTIONS = {
  STRIKE: "strike",
  DEFEND: "defend",
  SIGNATURE: "signature",
  SWITCH: "switch",
  ENVIRONMENTAL: "environmental",
} as const;
export type BattleAction = (typeof BATTLE_ACTIONS)[keyof typeof BATTLE_ACTIONS];

export const FAILURE_CODES = {
  BUSY: "BUSY",
  INVALID_COMMAND: "INVALID_COMMAND",
  INVALID_CONTEXT: "INVALID_CONTEXT",
  INVALID_POSITION: "INVALID_POSITION",
  INVALID_PHASE: "INVALID_PHASE",
  INVALID_LOCATION: "INVALID_LOCATION",
  TARGET_NOT_FOUND: "TARGET_NOT_FOUND",
  CAPABILITY_REQUIRED: "CAPABILITY_REQUIRED",
  HUMAN_DISCOVERY_REQUIRED: "HUMAN_DISCOVERY_REQUIRED",
  DIRECTIVE_BLOCKED: "DIRECTIVE_BLOCKED",
  DIRECTIVE_HUMAN_ONLY: "DIRECTIVE_HUMAN_ONLY",
  PUZZLE_ORDER: "PUZZLE_ORDER",
  ACCESS_SIGIL_REQUIRED: "ACCESS_SIGIL_REQUIRED",
  BATTLE_REQUIRED: "BATTLE_REQUIRED",
  BATTLE_NOT_ACTIVE: "BATTLE_NOT_ACTIVE",
  BATTLE_TURN: "BATTLE_TURN",
  INVALID_BATTLE_ACTION: "INVALID_BATTLE_ACTION",
  SIGNATURE_ALREADY_USED: "SIGNATURE_ALREADY_USED",
  NO_ACTIVE_BATTLE: "NO_ACTIVE_BATTLE",
  CORE_NOT_REACHED: "CORE_NOT_REACHED",
  OUT_OF_RANGE: "OUT_OF_RANGE",
  PERSISTENCE_FAILED: "PERSISTENCE_FAILED",
  INCOMPATIBLE_SAVE: "INCOMPATIBLE_SAVE",
} as const;
export type FailureCode = (typeof FAILURE_CODES)[keyof typeof FAILURE_CODES];
export type ResultCode = "OK" | FailureCode;

export interface DomainError {
  readonly code: FailureCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface PartyMember {
  readonly id: WildGentId;
  readonly name: string;
  readonly role: "starter" | "resonant";
  readonly capabilities: readonly Capability[];
  readonly maxHp: number;
  readonly hp: number;
  readonly attack: number;
  readonly signatureDamage: number;
  readonly signatureUsed: boolean;
  readonly active: boolean;
}

export interface RelayState {
  readonly damaged: boolean;
  readonly housingCleared: boolean;
  readonly energyCellCharged: boolean;
  readonly aligned: boolean;
  readonly restored: boolean;
}

export interface RuinPuzzleState {
  readonly rubbleCleared: boolean;
  readonly powerRestored: boolean;
  readonly doorInspected: boolean;
  readonly accessSigilRequired: boolean;
  readonly maintenancePathDiscovered: boolean;
  readonly doorOpened: boolean;
  readonly order: readonly string[];
}

export interface ResonanceState {
  readonly occurred: boolean;
  readonly wildGentId: "voltyn" | null;
  readonly unlockedCapability: "interface" | null;
}

export interface DirectiveState {
  readonly avoidBattles: boolean;
  readonly active: readonly DirectiveId[];
  readonly humanOwned: readonly DirectiveId[];
}

export interface DiscoveryState {
  readonly id: DiscoveryId;
  readonly discovered: boolean;
  readonly discoveryPolicy: "humanInteractionRequired";
  readonly sharedWithAgent: boolean;
}

export interface TargetState {
  readonly id: string;
  readonly label: string;
  readonly kind: "scene" | "wildGent" | "prop" | "door" | "guardian" | "core";
  readonly visible: boolean;
  readonly discoveryPolicy?: "humanInteractionRequired";
  readonly availableCapabilities: readonly Capability[];
}

export interface BattleLogEntry {
  readonly turn: number;
  readonly actor: "human" | "agent" | "system";
  readonly action: BattleAction | "counter" | "encounter" | "victory" | "defeat";
  readonly sourceId?: WildGentId | "warped-guardian";
  readonly damage?: number;
  readonly message: string;
}

export type BattleStatus = "encounter" | "active" | "won" | "lost";

export interface BattleState {
  readonly status: BattleStatus;
  readonly guardianId: "warped-guardian";
  readonly guardianMaxHp: number;
  readonly guardianHp: number;
  readonly playerMaxHp: number;
  readonly playerHp: number;
  readonly activeWildGentId: WildGentId;
  readonly turn: number;
  readonly turnOwner: "human" | "agent" | "system";
  readonly defending: boolean;
  readonly environmentalUsed: boolean;
  readonly log: readonly BattleLogEntry[];
}

export interface ActivityEntry {
  readonly id: number;
  readonly kind: "accepted" | "refused" | "system";
  readonly commandType: string;
  readonly actor: "human" | "agent" | "system";
  readonly code: ResultCode;
  readonly message: string;
}

export interface CheckpointState {
  readonly available: boolean;
  readonly label: "start" | "resonance" | "discovery" | "battle" | "complete";
  readonly snapshot: GameSnapshot | null;
}

/** Versioned aggregate; this is the only authoritative game state. */
export interface GameSnapshot {
  readonly schemaVersion: SaveSchemaVersion;
  readonly version: number;
  readonly mode: GameMode;
  readonly phase: GamePhase;
  readonly scene: SceneId;
  readonly currentScene: SceneId;
  readonly location: LocationId;
  readonly position: GridPosition;
  readonly party: readonly PartyMember[];
  readonly partyIds: readonly WildGentId[];
  readonly activeWildGentId: WildGentId;
  readonly capabilities: readonly Capability[];
  readonly unlockedCapabilities: readonly Capability[];
  readonly relay: RelayState;
  readonly resonance: ResonanceState;
  /** True once the human has lit the camp beacon; this is authoritative, not presentation state. */
  readonly beaconLit: boolean;
  /** Convenience alias used by the HUD and WebMCP adapter. */
  readonly voltynResonance: boolean;
  readonly puzzle: RuinPuzzleState;
  readonly discoveries: readonly DiscoveryState[];
  readonly sharedDiscoveries: readonly DiscoveryId[];
  readonly directives: DirectiveState;
  readonly humanDirectives: readonly DirectiveId[];
  readonly visibleTargets: readonly TargetState[];
  readonly battle: BattleState | null;
  readonly ancientCoreClaimed: boolean;
  readonly completed: boolean;
  readonly activity: readonly ActivityEntry[];
  readonly checkpoint: CheckpointState;
}

export interface DispatchAccepted {
  readonly ok: true;
  readonly status: "accepted";
  readonly code: "OK";
  readonly message: string;
  readonly snapshot: GameSnapshot;
  readonly events: readonly ActivityEntry[];
}

export interface DispatchRefused {
  readonly ok: false;
  readonly status: "refused";
  readonly code: FailureCode;
  readonly message: string;
  readonly error: DomainError;
  readonly snapshot: GameSnapshot;
  readonly events: readonly ActivityEntry[];
}

export type DispatchResult = DispatchAccepted | DispatchRefused;
export type ResetResult = DispatchAccepted;

export type QueryName =
  | "snapshot"
  | "state"
  | "phase"
  | "location"
  | "world"
  | "look_around"
  | "targets"
  | "capabilities"
  | "available-capabilities"
  | "availableCapabilities"
  | "party"
  | "relay"
  | "resonance"
  | "puzzle"
  | "discoveries"
  | "directives"
  | "battle"
  | "activity"
  | "can";

export type GameQuery =
  | QueryName
  | {
      readonly type: QueryName | string;
      readonly targetId?: string;
      readonly capability?: Capability | string;
      readonly command?: GameCommand;
    };

export interface CapabilitiesQuery {
  readonly capabilities: readonly Capability[];
  readonly availableCapabilities: readonly Capability[];
  readonly unlockedCapabilities: readonly Capability[];
}

export interface WorldQuery {
  readonly phase: GamePhase;
  readonly scene: SceneId;
  readonly location: LocationId;
  readonly position: GridPosition;
  readonly visibleTargets: readonly TargetState[];
  readonly routes: readonly LocationId[];
  readonly humanDiscoveryRequired: boolean;
}

export interface CanQuery {
  readonly can: boolean;
  readonly reason?: DomainError;
}

export type QueryResult =
  | GameSnapshot
  | string
  | readonly Capability[]
  | readonly PartyMember[]
  | RelayState
  | ResonanceState
  | RuinPuzzleState
  | readonly DiscoveryState[]
  | DirectiveState
  | BattleState
  | null
  | readonly ActivityEntry[]
  | readonly TargetState[]
  | CapabilitiesQuery
  | WorldQuery
  | CanQuery
  | { readonly error: DomainError };

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Raw storage adapter; the engine owns JSON encoding and validation. */
export interface PersistenceAdapter {
  load(): string | null;
  save(serializedSnapshot: string): void;
  clear(): void;
}

export interface GameEngineOptions {
  readonly mode?: GameMode | "newJourney" | "judgeDemo";
  readonly storage?: PersistenceAdapter | StorageLike;
  readonly storageKey?: string;
  readonly initialSnapshot?: GameSnapshot;
  readonly persist?: boolean;
}

export type GameFailureCode = FailureCode | "UNKNOWN";

export interface GameFailureShape {
  readonly code: GameFailureCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface GameEngine {
  readonly dispatch: (
    command: GameCommand,
    context?: CommandContext,
  ) => EffectType<DispatchResult, never>;
  readonly dispatchSync: (command: GameCommand, context?: CommandContext) => DispatchResult;
  readonly query: (query: GameQuery) => QueryResult;
  readonly getSnapshot: () => GameSnapshot;
  readonly subscribe: (listener: SnapshotListener) => () => void;
  readonly reset: (mode?: ResetMode) => EffectType<ResetResult, never>;
  readonly resetSync: (mode?: ResetMode) => ResetResult;
}

export type SnapshotListener = (snapshot: GameSnapshot, event?: ActivityEntry) => void;
