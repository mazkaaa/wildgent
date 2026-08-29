import { Effect } from "effect";
import type { Effect as EffectType } from "effect/Effect";
import { failure } from "./failures";
import { createFixture, createJudgeDemoSnapshot, createNewJourneySnapshot } from "./fixtures";
import { decodeSnapshot } from "./schema";
import {
  type ActivityEntry,
  BATTLE_ACTIONS,
  type BattleAction,
  type BattleLogEntry,
  type BattleState,
  CAPABILITIES,
  type CapabilitiesQuery,
  type CheckpointState,
  type CommandContext,
  DIRECTIVES,
  DISCOVERIES,
  type DirectiveId,
  type DispatchRefused,
  type DispatchResult,
  type DomainError,
  FAILURE_CODES,
  GAME_MODES,
  type GameCommand,
  type GameEngine,
  type GameMode,
  type GamePhase,
  type GameQuery,
  type GameSnapshot,
  GRID_HEIGHT,
  GRID_WIDTH,
  type GridPosition,
  type LocationId,
  type PersistenceAdapter,
  PHASES,
  type QueryResult,
  RESET_MODES,
  type RelayState,
  type ResetMode,
  type ResetResult,
  type RuinPuzzleState,
  SAVE_SCHEMA_VERSION,
  SCENES,
  type SnapshotListener,
  type StorageLike,
  type TargetState,
  WILD_GENTS,
  type WildGentId,
} from "./types";

export const DEFAULT_STORAGE_KEY = "wildgent.game.snapshot.v1";

const MAX_ACTIVITY_ENTRIES = 80;

const isStorageAdapter = (value: PersistenceAdapter | StorageLike): value is PersistenceAdapter =>
  "load" in value && "save" in value && "clear" in value;

/** A deterministic in-memory persistence adapter used by tests and SSR. */
export class InMemoryPersistenceAdapter implements PersistenceAdapter {
  private serialized: string | null = null;

  load(): string | null {
    return this.serialized;
  }

  save(serializedSnapshot: string): void {
    this.serialized = serializedSnapshot;
  }

  clear(): void {
    this.serialized = null;
  }
}

/** A safe wrapper around browser localStorage. */
export class LocalStoragePersistenceAdapter implements PersistenceAdapter {
  constructor(
    private readonly storage: StorageLike,
    private readonly key: string = DEFAULT_STORAGE_KEY,
  ) {}

  load(): string | null {
    try {
      return this.storage.getItem(this.key);
    } catch {
      return null;
    }
  }

  save(serializedSnapshot: string): void {
    this.storage.setItem(this.key, serializedSnapshot);
  }

  clear(): void {
    try {
      this.storage.removeItem(this.key);
    } catch {
      // Clearing is best effort. A blocked storage area should not stop play.
    }
  }
}

/**
 * Returns localStorage when it is available and usable, otherwise an isolated
 * in-memory store. This keeps the engine playable in SSR, tests, and privacy
 * modes where accessing localStorage can throw a SecurityError.
 */
export const createLocalStorageAdapter = (
  storage?: StorageLike,
  key: string = DEFAULT_STORAGE_KEY,
): PersistenceAdapter => {
  if (storage !== undefined) {
    try {
      storage.getItem(key);
      return new LocalStoragePersistenceAdapter(storage, key);
    } catch {
      return new InMemoryPersistenceAdapter();
    }
  }

  try {
    const candidate = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (candidate !== undefined) {
      candidate.getItem(key);
      return new LocalStoragePersistenceAdapter(candidate, key);
    }
  } catch {
    // The fallback below is intentional.
  }

  return new InMemoryPersistenceAdapter();
};

const clone = <T>(value: T): T => {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
};

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const checkpointLabel = (value: unknown): CheckpointState["label"] =>
  value === "resonance" || value === "discovery" || value === "battle" || value === "complete"
    ? value
    : "start";

const actorOf = (context: CommandContext): "human" | "agent" | "system" => {
  if (
    context.actor === "agent" ||
    context.actor === "echo" ||
    context.source === "agent" ||
    context.source === "webmcp"
  ) {
    return "agent";
  }
  if (context.actor === "system" || context.source === "system") {
    return "system";
  }
  return "human";
};

const normalized = (value: unknown): string =>
  typeof value === "string"
    ? value
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_")
    : "";

const isValidGridPosition = (value: unknown): value is GridPosition =>
  isRecord(value) &&
  typeof value.x === "number" &&
  Number.isInteger(value.x) &&
  value.x >= 0 &&
  value.x < GRID_WIDTH &&
  typeof value.y === "number" &&
  Number.isInteger(value.y) &&
  value.y >= 0 &&
  value.y < GRID_HEIGHT;

const positionDetails = (position: unknown): Readonly<Record<string, unknown>> => ({
  position,
  grid: {
    width: GRID_WIDTH,
    height: GRID_HEIGHT,
    min: { x: 0, y: 0 },
    max: { x: GRID_WIDTH - 1, y: GRID_HEIGHT - 1 },
  },
});

const normalizedDirection = (value: unknown): "north" | "south" | "east" | "west" | null => {
  switch (normalized(value)) {
    case "north":
    case "up":
      return "north";
    case "south":
    case "down":
      return "south";
    case "east":
    case "right":
      return "east";
    case "west":
    case "left":
      return "west";
    default:
      return null;
  }
};

const targetOf = (command: GameCommand): string => {
  const candidate = command.targetId ?? command.target ?? command.locationId;
  return typeof candidate === "string" ? normalized(candidate) : "";
};

const capabilityOf = (command: GameCommand): string => {
  const explicit = normalized(command.capability);
  if (explicit !== "") return explicit;
  const type = normalized(command.type);
  if (type === "ignite" || type === "break" || type === "interface") return type;
  return "";
};

const battleActionOf = (command: GameCommand): BattleAction | null => {
  const explicit = normalized(command.action);
  const type = normalized(command.type);
  const candidate = explicit || (type === "battle_action" ? "" : type);
  switch (candidate) {
    case BATTLE_ACTIONS.STRIKE:
    case BATTLE_ACTIONS.DEFEND:
    case BATTLE_ACTIONS.SIGNATURE:
    case BATTLE_ACTIONS.SWITCH:
    case BATTLE_ACTIONS.ENVIRONMENTAL:
      return candidate;
    case "environment":
      return BATTLE_ACTIONS.ENVIRONMENTAL;
    default:
      return null;
  }
};

const normalizeMode = (value: GameMode | "newJourney" | "judgeDemo" | undefined): GameMode =>
  value === "judgeDemo"
    ? GAME_MODES.JUDGE_DEMO
    : value === "newJourney"
      ? GAME_MODES.NEW_JOURNEY
      : (value ?? GAME_MODES.NEW_JOURNEY);

const normalizeLocation = (value: string): LocationId | null => {
  switch (value) {
    case "camp":
    case "approach":
      return SCENES.CAMP;
    case "relay":
    case "facility":
    case "voltyn_relay":
    case "voltyn_relay_room":
    case "voltyn":
      return SCENES.RELAY;
    case "ruins":
    case "ruin":
    case "facility_ruins":
      return SCENES.RUINS;
    case "core":
    case "ancient_core":
    case "ancientcore":
      return SCENES.CORE;
    default:
      return null;
  }
};

const normalizeCapability = (
  value: string,
): (typeof CAPABILITIES)[keyof typeof CAPABILITIES] | null => {
  switch (value) {
    case "ignite":
      return CAPABILITIES.IGNITE;
    case "break":
      return CAPABILITIES.BREAK;
    case "interface":
      return CAPABILITIES.INTERFACE;
    default:
      return null;
  }
};

const normalizeDirective = (value: string): DirectiveId | null => {
  switch (value) {
    case "avoid_battles":
    case "avoidbattle":
    case "avoidbattles":
    case "avoid_battle":
    case "avoid_combat":
      return DIRECTIVES.AVOID_BATTLES;
    default:
      return null;
  }
};

const normalizeWildGent = (value: string): WildGentId | null => {
  switch (value) {
    case "cindra":
      return WILD_GENTS.CINDRA;
    case "grum":
      return WILD_GENTS.GRUM;
    case "voltyn":
      return WILD_GENTS.VOLTYN;
    case "warped_guardian":
    case "guardian":
      return WILD_GENTS.WARPED_GUARDIAN;
    default:
      return null;
  }
};

const checkpointSnapshot = (snapshot: GameSnapshot): GameSnapshot => ({
  ...clone(snapshot),
  checkpoint: {
    available: true,
    label: snapshot.checkpoint.label,
    snapshot: null,
  },
});

const relayComplete = (relay: RelayState): RelayState => ({
  ...relay,
  damaged: false,
  housingCleared: true,
  energyCellCharged: true,
  aligned: true,
  restored: true,
});

const puzzleStep = (puzzle: RuinPuzzleState, step: string): RuinPuzzleState => ({
  ...puzzle,
  order: puzzle.order.includes(step) ? puzzle.order : [...puzzle.order, step],
});

const initialBattle = (activeWildGentId: WildGentId): BattleState => ({
  status: "encounter",
  guardianId: WILD_GENTS.WARPED_GUARDIAN,
  guardianMaxHp: 18,
  guardianHp: 18,
  playerMaxHp: activeWildGentId === WILD_GENTS.GRUM ? 22 : 18,
  playerHp: activeWildGentId === WILD_GENTS.GRUM ? 22 : 18,
  activeWildGentId,
  turn: 0,
  turnOwner: "system",
  defending: false,
  environmentalUsed: false,
  log: [
    {
      turn: 0,
      actor: "system",
      action: "encounter",
      sourceId: WILD_GENTS.WARPED_GUARDIAN,
      message: "A warped guardian blocks the Ancient Core.",
    },
  ],
});

const canonicalPosition = (target: string): GridPosition | null => {
  switch (normalized(target)) {
    case "camp":
    case "approach":
    case "echo_beacon":
    case "beacon":
    case "ruins":
    case "ruin":
    case "facility_ruins":
      return { x: 1, y: 1 };
    case "relay":
    case "facility":
    case "voltyn_relay":
    case "voltyn_relay_room":
    case "voltyn":
      return { x: 5, y: 2 };
    case "ruin_rubble":
    case "rubble":
      return { x: 2, y: 2 };
    case "ruin_power":
    case "power":
    case "power_panel":
      return { x: 5, y: 3 };
    case "ruin_door":
    case "door":
    case "powered_door":
      return { x: 7, y: 6 };
    case "maintenance_path":
    case "cyan_signal":
    case "ruin_signal":
      return { x: 8, y: 2 };
    case "core":
    case "warped_guardian":
    case "guardian":
      return { x: 7, y: 4 };
    case "ancient_core":
    case "ancientcore":
      return { x: 4, y: 4 };
    default:
      return null;
  }
};

const positionForLocation = (location: LocationId): GridPosition =>
  location === SCENES.RELAY
    ? { x: 5, y: 2 }
    : location === SCENES.CORE
      ? { x: 7, y: 4 }
      : { x: 1, y: 1 };

const canonicalTargetId = (target: string): string => target.replace(/_/g, "-");

const proximityError = (snapshot: GameSnapshot, target: string): DomainError | null => {
  const requiredPosition = canonicalPosition(target);
  if (requiredPosition === null) return null;
  if (snapshot.position.x === requiredPosition.x && snapshot.position.y === requiredPosition.y) {
    return null;
  }
  return failure(
    FAILURE_CODES.OUT_OF_RANGE,
    `Move to ${canonicalTargetId(target)} before using it.`,
    {
      targetId: canonicalTargetId(target),
      currentPosition: { ...snapshot.position },
      requiredPosition,
    },
  );
};

const visibleTargets = (snapshot: GameSnapshot): readonly TargetState[] => {
  const common: TargetState[] = [];
  if (snapshot.scene === SCENES.CAMP) {
    common.push({
      id: "echo-beacon",
      label: snapshot.beaconLit ? "Lit Echo beacon" : "Echo beacon",
      kind: "prop",
      visible: true,
      availableCapabilities: [CAPABILITIES.IGNITE],
    });
    if (snapshot.beaconLit) {
      common.push({
        id: "voltyn-relay",
        label: "Damaged Voltyn relay",
        kind: "scene",
        visible: true,
        availableCapabilities: [],
      });
    }
  }

  if (snapshot.scene === SCENES.RELAY) {
    common.push(
      {
        id: "voltyn-relay",
        label: snapshot.relay.restored ? "Restored Voltyn relay" : "Damaged Voltyn relay",
        kind: "prop",
        visible: true,
        availableCapabilities: [CAPABILITIES.BREAK, CAPABILITIES.IGNITE],
      },
      {
        id: "echo-beacon",
        label: "Echo beacon",
        kind: "prop",
        visible: true,
        availableCapabilities: [CAPABILITIES.IGNITE],
      },
    );
    if (snapshot.relay.restored) {
      common.push({
        id: "ruins",
        label: "The signal ruins",
        kind: "scene",
        visible: true,
        availableCapabilities: [],
      });
    }
  }

  if (snapshot.scene === SCENES.RUINS) {
    if (!snapshot.puzzle.rubbleCleared) {
      common.push({
        id: "ruin-rubble",
        label: "Rubble choking the ruin entrance",
        kind: "prop",
        visible: true,
        availableCapabilities: [CAPABILITIES.BREAK],
      });
    }
    if (snapshot.puzzle.rubbleCleared && !snapshot.puzzle.powerRestored) {
      common.push({
        id: "ruin-power",
        label: "Cold relay panel",
        kind: "prop",
        visible: true,
        availableCapabilities: [CAPABILITIES.IGNITE],
      });
    }
    if (snapshot.puzzle.powerRestored) {
      common.push({
        id: "ruin-door",
        label: "Powered ruin door",
        kind: "door",
        visible: true,
        availableCapabilities: [CAPABILITIES.INTERFACE],
      });
    }
    common.push({
      id: "maintenance-path",
      label: "Cyan maintenance route",
      kind: "prop",
      visible: true,
      discoveryPolicy: "humanInteractionRequired",
      availableCapabilities: [],
    });
    if (snapshot.puzzle.doorOpened) {
      common.push({
        id: "warped-guardian",
        label: "Warped guardian",
        kind: "guardian",
        visible: true,
        availableCapabilities: [],
      });
    }
  }

  if (snapshot.scene === SCENES.CORE) {
    if (snapshot.battle !== null && snapshot.battle.status !== "won") {
      common.push({
        id: "warped-guardian",
        label: "Warped guardian",
        kind: "guardian",
        visible: true,
        availableCapabilities: [],
      });
    }
    common.push({
      id: "ancient-core",
      label: "Ancient Core",
      kind: "core",
      visible: snapshot.battle?.status === "won" || snapshot.ancientCoreClaimed,
      availableCapabilities: [],
    });
  }

  return common;
};

const routeTargets = (snapshot: GameSnapshot): readonly LocationId[] => {
  switch (snapshot.location) {
    case SCENES.CAMP:
      return snapshot.beaconLit ? [SCENES.RELAY] : [];
    case SCENES.RELAY:
      return snapshot.relay.restored ? [SCENES.CAMP, SCENES.RUINS] : [SCENES.CAMP];
    case SCENES.RUINS:
      return snapshot.puzzle.doorOpened ? [SCENES.RELAY, SCENES.CORE] : [SCENES.RELAY];
    case SCENES.CORE:
      return [SCENES.RUINS];
    default:
      return [];
  }
};

const capabilityListForParty = (
  snapshot: GameSnapshot,
): readonly (typeof CAPABILITIES)[keyof typeof CAPABILITIES][] =>
  unique(snapshot.party.flatMap((member) => member.capabilities));

type AcceptedTransition = {
  readonly accepted: true;
  readonly snapshot: GameSnapshot;
  readonly message: string;
};

type RefusedTransition = {
  readonly accepted: false;
  readonly error: DomainError;
};

type Transition = AcceptedTransition | RefusedTransition;

export class WildGentGameEngine implements GameEngine {
  private snapshot: GameSnapshot;
  private readonly listeners = new Set<SnapshotListener>();
  private readonly persistence: PersistenceAdapter;
  private readonly storageKey: string;
  private readonly persistEnabled: boolean;
  private mutationActive = false;

  constructor(options: import("./types").GameEngineOptions = {}) {
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
    this.persistEnabled = options.persist !== false;
    this.persistence = options.storage
      ? isStorageAdapter(options.storage)
        ? options.storage
        : new LocalStoragePersistenceAdapter(options.storage, this.storageKey)
      : createLocalStorageAdapter(undefined, this.storageKey);

    const explicitMode = options.mode !== undefined;
    const requestedMode = normalizeMode(options.mode);
    const supplied =
      options.initialSnapshot === undefined ? null : decodeSnapshot(options.initialSnapshot);
    const persisted = !explicitMode && supplied === null ? this.readPersistedSnapshot() : null;
    const initial = this.normalizeSnapshot(supplied ?? persisted ?? createFixture(requestedMode));
    this.snapshot =
      initial.checkpoint.snapshot === null
        ? {
            ...initial,
            checkpoint: {
              ...initial.checkpoint,
              snapshot: checkpointSnapshot(initial),
            },
          }
        : initial;
  }

  dispatch(command: GameCommand, context: CommandContext = {}): EffectType<DispatchResult, never> {
    return Effect.sync(() => this.execute(command, context));
  }

  dispatchSync(command: GameCommand, context: CommandContext = {}): DispatchResult {
    return Effect.runSync(this.dispatch(command, context));
  }

  query(query: GameQuery): QueryResult {
    const name = normalized(typeof query === "string" ? query : query.type);
    switch (name) {
      case "snapshot":
      case "state":
        return this.getSnapshot();
      case "phase":
        return this.snapshot.phase;
      case "location":
        return this.snapshot.location;
      case "world":
      case "look_around":
        return this.worldQuery();
      case "targets":
        return this.visibleTargetsForStructuredQuery();
      case "capabilities":
      case "available_capabilities":
      case "availablecapabilities":
      case "capability":
        return this.capabilitiesQuery();
      case "party":
        return clone(this.snapshot.party);
      case "relay":
        return clone(this.snapshot.relay);
      case "resonance":
        return clone(this.snapshot.resonance);
      case "puzzle":
        return clone(this.snapshot.puzzle);
      case "discoveries":
        return clone(this.snapshot.discoveries);
      case "directives":
        return clone(this.snapshot.directives);
      case "battle":
        return clone(this.snapshot.battle);
      case "activity":
        return clone(this.snapshot.activity);
      case "can": {
        const command = typeof query === "string" ? undefined : query.command;
        if (command === undefined) {
          return {
            can: false,
            reason: failure(FAILURE_CODES.INVALID_COMMAND, "The can query requires a command."),
          };
        }
        const transition = this.transition(this.snapshot, command, "agent", {});
        return transition.accepted ? { can: true } : { can: false, reason: transition.error };
      }
      default:
        return {
          error: failure(
            FAILURE_CODES.INVALID_COMMAND,
            `Unknown game query: ${typeof query === "string" ? query : query.type}`,
          ),
        };
    }
  }

  getSnapshot(): GameSnapshot {
    return clone(this.snapshot);
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reset(mode: ResetMode = RESET_MODES.NEW_JOURNEY): EffectType<ResetResult, never> {
    return Effect.sync(() => this.resetNow(mode));
  }

  resetSync(mode: ResetMode = RESET_MODES.NEW_JOURNEY): ResetResult {
    return Effect.runSync(this.reset(mode));
  }

  private readPersistedSnapshot(): GameSnapshot | null {
    if (!this.persistEnabled) return null;
    try {
      const serialized = this.persistence.load();
      if (serialized === null) return null;
      return decodeSnapshot(JSON.parse(serialized));
    } catch {
      return null;
    }
  }

  private resetNow(mode: ResetMode): ResetResult {
    const normalizedMode =
      mode === "checkpoint"
        ? null
        : mode === "judgeDemo" || mode === RESET_MODES.JUDGE_DEMO
          ? GAME_MODES.JUDGE_DEMO
          : GAME_MODES.NEW_JOURNEY;
    const checkpoint = this.snapshot.checkpoint.snapshot;
    const next =
      normalizedMode === null && checkpoint !== null
        ? this.normalizeSnapshot(clone(checkpoint))
        : this.normalizeSnapshot(
            normalizedMode === GAME_MODES.JUDGE_DEMO
              ? createJudgeDemoSnapshot()
              : createNewJourneySnapshot(),
          );

    if (mode === "clean") {
      try {
        this.persistence.clear();
      } catch {
        // A clean reset still resets the in-memory state if storage is blocked.
      }
    }

    const event = this.makeActivity(
      next,
      "accepted",
      "RESET",
      "system",
      "OK",
      normalizedMode === null
        ? "Returned to the last WildGent checkpoint."
        : `Reset to ${next.mode}.`,
    );
    const committed = this.withActivity(
      {
        ...next,
        version: 0,
        checkpoint: {
          available: true,
          label: normalizedMode === null ? next.checkpoint.label : "start",
          snapshot: null,
        },
      },
      event,
    );
    this.commit(committed, event);
    return {
      ok: true,
      status: "accepted",
      code: "OK",
      message: event.message,
      snapshot: this.getSnapshot(),
      events: [event],
    };
  }

  private execute(command: GameCommand, context: CommandContext): DispatchResult {
    const actor = actorOf(context);
    if (this.mutationActive || context.mutationState === "active") {
      return this.refuse(
        command,
        actor,
        failure(FAILURE_CODES.BUSY, "Another game mutation is still resolving."),
      );
    }

    this.mutationActive = true;
    try {
      const transition = this.transition(this.snapshot, command, actor, context);
      if (!transition.accepted) {
        return this.refuse(command, actor, transition.error);
      }

      const event = this.makeActivity(
        transition.snapshot,
        "accepted",
        command.type,
        actor,
        "OK",
        transition.message,
      );
      const committed = this.withActivity(transition.snapshot, event);
      this.commit(committed, event);
      return {
        ok: true,
        status: "accepted",
        code: "OK",
        message: event.message,
        snapshot: this.getSnapshot(),
        events: [event],
      };
    } finally {
      this.mutationActive = false;
    }
  }

  private refuse(
    command: GameCommand,
    actor: "human" | "agent" | "system",
    error: DomainError,
  ): DispatchRefused {
    const event = this.makeActivity(
      this.snapshot,
      "refused",
      command.type,
      actor,
      error.code,
      error.message,
    );
    const committed = this.withActivity(this.snapshot, event);
    this.commit(committed, event);
    return {
      ok: false,
      status: "refused",
      code: error.code,
      message: error.message,
      error,
      snapshot: this.getSnapshot(),
      events: [event],
    };
  }

  private commit(snapshot: GameSnapshot, event: ActivityEntry): void {
    const withVersion: GameSnapshot = {
      ...snapshot,
      version: this.snapshot.version + 1,
    };
    const checkpointed =
      withVersion.checkpoint.snapshot === null
        ? {
            ...withVersion,
            checkpoint: {
              ...withVersion.checkpoint,
              snapshot: checkpointSnapshot(withVersion),
            },
          }
        : withVersion;
    if (this.persistEnabled) {
      try {
        this.persistence.save(JSON.stringify(checkpointed));
      } catch {
        // localStorage is optional; gameplay continues in memory.
      }
    }
    this.snapshot = this.normalizeSnapshot(checkpointed);
    const snapshotForListeners = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshotForListeners, event);
      } catch {
        // A presentation listener must not break the authoritative engine.
      }
    }
  }

  private makeActivity(
    snapshot: GameSnapshot,
    kind: ActivityEntry["kind"],
    commandType: string,
    actor: ActivityEntry["actor"],
    code: ActivityEntry["code"],
    message: string,
  ): ActivityEntry {
    const latest = snapshot.activity.at(-1);
    return {
      id: (latest?.id ?? 0) + 1,
      kind,
      commandType,
      actor,
      code,
      message,
    };
  }

  private withActivity(snapshot: GameSnapshot, event: ActivityEntry): GameSnapshot {
    return {
      ...snapshot,
      activity: [...snapshot.activity, event].slice(-MAX_ACTIVITY_ENTRIES),
    };
  }

  private normalizeSnapshot(snapshot: GameSnapshot): GameSnapshot {
    const party = snapshot.party.map((member) => ({ ...member }));
    const partyIds = unique(party.map((member) => member.id));
    const derivedCapabilities = capabilityListForParty(snapshot);
    const capabilities = unique([
      ...derivedCapabilities,
      ...(snapshot.resonance.occurred || snapshot.voltynResonance ? [CAPABILITIES.INTERFACE] : []),
    ]);
    const unlockedCapabilities = unique([
      ...capabilities,
      ...(snapshot.resonance.occurred || snapshot.voltynResonance ? [CAPABILITIES.INTERFACE] : []),
    ]);
    const maintenance = snapshot.puzzle.maintenancePathDiscovered;
    const discoveries = snapshot.discoveries.map((discovery) => {
      if (
        discovery.id === DISCOVERIES.MAINTENANCE_PATH ||
        discovery.id === DISCOVERIES.CYAN_SIGNAL
      ) {
        return {
          ...discovery,
          discovered: maintenance || discovery.discovered,
          sharedWithAgent: maintenance || discovery.sharedWithAgent,
        };
      }
      return { ...discovery };
    });
    const sharedDiscoveries = unique([
      ...snapshot.sharedDiscoveries,
      ...(maintenance ? [DISCOVERIES.MAINTENANCE_PATH, DISCOVERIES.CYAN_SIGNAL] : []),
    ]);
    const activeDirectives = snapshot.directives.avoidBattles ? [DIRECTIVES.AVOID_BATTLES] : [];
    const next: GameSnapshot = {
      ...clone(snapshot),
      schemaVersion: SAVE_SCHEMA_VERSION,
      party,
      partyIds,
      capabilities,
      unlockedCapabilities,
      discoveries,
      sharedDiscoveries,
      directives: {
        ...snapshot.directives,
        active: activeDirectives,
        humanOwned: [DIRECTIVES.AVOID_BATTLES],
      },
      humanDirectives: activeDirectives,
      resonance: {
        ...snapshot.resonance,
        occurred: snapshot.resonance.occurred || snapshot.voltynResonance,
        wildGentId:
          snapshot.resonance.occurred || snapshot.voltynResonance ? WILD_GENTS.VOLTYN : null,
        unlockedCapability:
          snapshot.resonance.occurred || snapshot.voltynResonance ? CAPABILITIES.INTERFACE : null,
      },
      beaconLit: snapshot.beaconLit === true,
      voltynResonance: snapshot.resonance.occurred || snapshot.voltynResonance,
      position: isValidGridPosition(snapshot.position)
        ? { ...snapshot.position }
        : this.derivePosition(snapshot),
      visibleTargets: [],
      completed: snapshot.completed || snapshot.ancientCoreClaimed,
      checkpoint: (() => {
        const source: Record<string, unknown> = isRecord(snapshot.checkpoint)
          ? snapshot.checkpoint
          : {};
        const candidate = source.snapshot;
        return {
          available: source.available !== false,
          label: checkpointLabel(source.label),
          snapshot:
            candidate === null || candidate === undefined ? null : decodeSnapshot(candidate),
        };
      })(),
    };
    return {
      ...next,
      visibleTargets: visibleTargets(next),
    };
  }

  private derivePosition(snapshot: GameSnapshot): GridPosition {
    if (snapshot.phase === PHASES.COMPLETE || snapshot.ancientCoreClaimed) {
      return { x: 4, y: 4 };
    }
    if (snapshot.phase === PHASES.BATTLE || snapshot.scene === SCENES.CORE) {
      return snapshot.battle?.status === "won" ? { x: 4, y: 4 } : { x: 7, y: 4 };
    }
    if (snapshot.location === SCENES.RELAY) return { x: 5, y: 2 };
    return { x: 1, y: 1 };
  }

  private capabilitiesQuery(): CapabilitiesQuery {
    const capabilities = clone(this.snapshot.capabilities);
    return {
      capabilities,
      availableCapabilities: capabilities,
      unlockedCapabilities: clone(this.snapshot.unlockedCapabilities),
    };
  }

  private visibleTargetsForStructuredQuery(): readonly TargetState[] {
    return clone(
      this.snapshot.visibleTargets.filter(
        (target) =>
          target.id !== DISCOVERIES.MAINTENANCE_PATH ||
          this.snapshot.puzzle.maintenancePathDiscovered,
      ),
    );
  }

  private worldQuery() {
    return {
      phase: this.snapshot.phase,
      scene: this.snapshot.scene,
      location: this.snapshot.location,
      position: clone(this.snapshot.position),
      visibleTargets: this.visibleTargetsForStructuredQuery(),
      routes: clone(routeTargets(this.snapshot)),
      humanDiscoveryRequired:
        this.snapshot.scene === SCENES.RUINS &&
        this.snapshot.puzzle.doorInspected &&
        !this.snapshot.puzzle.maintenancePathDiscovered,
    };
  }

  private transition(
    snapshot: GameSnapshot,
    command: GameCommand,
    actor: "human" | "agent" | "system",
    context: CommandContext,
  ): Transition {
    const type = normalized(command.type);
    if (type === "new_journey" || type === "start_journey" || type === "start") {
      return {
        accepted: true,
        snapshot: this.normalizeSnapshot(createNewJourneySnapshot()),
        message: "A new journey begins at the camp.",
      };
    }

    if (type === "judge_demo" || type === "load_judge_demo") {
      return {
        accepted: true,
        snapshot: this.normalizeSnapshot(createJudgeDemoSnapshot()),
        message: "Judge Demo loaded before Voltyn Resonance.",
      };
    }

    if (type === "move" || type === "travel" || type === "enter") {
      return this.move(snapshot, command, actor);
    }

    if (type === "step") {
      return this.step(snapshot, command, actor);
    }

    if (type === "move_to_position" || type === "movetoposition") {
      return this.moveToPosition(snapshot, command, actor);
    }

    if (type === "inspect" || type === "look") {
      return this.inspect(snapshot, command, actor);
    }

    if (type === "interact") {
      const target = targetOf(command);
      return target === "maintenance_path" || target === "cyan_signal" || target === "ruin_signal"
        ? this.discover(snapshot, command, actor)
        : this.inspect(snapshot, command, actor);
    }

    if (
      type === "ignite" ||
      type === "break" ||
      type === "interface" ||
      type === "use_capability" ||
      type === "capability"
    ) {
      return this.applyCapability(snapshot, command, actor, context);
    }

    if (
      type === "discover" ||
      type === "discover_maintenance_path" ||
      type === "discovermaintenancepath"
    ) {
      return this.discover(snapshot, command, actor);
    }

    if (
      type === "set_directive" ||
      type === "setdirective" ||
      type === "avoid_battles" ||
      type === "avoidbattles"
    ) {
      return this.setDirective(snapshot, command, actor);
    }

    if (type === "start_battle" || type === "startbattle" || type === "fight") {
      return this.startBattle(snapshot, actor);
    }

    if (
      type === "battle_action" ||
      type === "battleaction" ||
      type === "strike" ||
      type === "defend" ||
      type === "signature" ||
      type === "switch" ||
      type === "environmental"
    ) {
      return this.battleAction(snapshot, command, actor);
    }

    if (type === "open_door" || type === "opendoor" || type === "open") {
      return this.openDoor(snapshot, actor);
    }

    if (
      type === "claim_core" ||
      type === "claimcore" ||
      type === "complete" ||
      type === "collect_core"
    ) {
      return this.claimCore(snapshot);
    }

    if (type === "restore_relay" || type === "repair_relay") {
      return this.restoreRelay(snapshot);
    }

    return {
      accepted: false,
      error: failure(FAILURE_CODES.INVALID_COMMAND, `Unknown game command: ${command.type}`),
    };
  }

  private move(
    snapshot: GameSnapshot,
    command: GameCommand,
    actor: "human" | "agent" | "system",
  ): Transition {
    if (snapshot.phase === PHASES.BATTLE || snapshot.phase === PHASES.COMPLETE) {
      return {
        accepted: false,
        error: failure(FAILURE_CODES.INVALID_PHASE, "Movement is unavailable in this phase."),
      };
    }

    const target = targetOf(command);
    if (target === "maintenance_path" || target === "cyan_signal" || target === "ruin_signal") {
      if (!snapshot.puzzle.maintenancePathDiscovered) {
        return {
          accepted: false,
          error: failure(
            FAILURE_CODES.HUMAN_DISCOVERY_REQUIRED,
            "The cyan maintenance route must be discovered by a human first.",
          ),
        };
      }
    }

    const requested = normalizeLocation(target);
    const routes = routeTargets(snapshot);
    if (requested !== null && routes.includes(requested)) {
      if (requested === SCENES.CORE) return this.enterCore(snapshot, actor);

      const nextPhase: GamePhase =
        requested === SCENES.CAMP
          ? PHASES.CAMP
          : requested === SCENES.RELAY
            ? PHASES.RELAY
            : PHASES.RUINS;
      return {
        accepted: true,
        snapshot: this.normalizeSnapshot({
          ...snapshot,
          phase: nextPhase,
          scene: requested,
          currentScene: requested,
          location: requested,
          position: positionForLocation(requested),
        }),
        message: `Moved to ${requested}.`,
      };
    }

    const targetPosition = canonicalPosition(target);
    const visibleTarget = snapshot.visibleTargets.find(
      (candidate) => normalized(candidate.id) === target && candidate.visible,
    );
    const discoveredTarget =
      (target === "maintenance_path" || target === "cyan_signal" || target === "ruin_signal") &&
      snapshot.puzzle.maintenancePathDiscovered;
    if (targetPosition !== null && (visibleTarget !== undefined || discoveredTarget)) {
      return {
        accepted: true,
        snapshot: this.normalizeSnapshot({ ...snapshot, position: targetPosition }),
        message: `Moved to ${target}.`,
      };
    }

    if (requested !== null && requested === snapshot.location) {
      return {
        accepted: true,
        snapshot: this.normalizeSnapshot({
          ...snapshot,
          position: positionForLocation(requested),
        }),
        message: `Moved to ${requested}.`,
      };
    }

    if (requested === null) {
      return {
        accepted: false,
        error: failure(FAILURE_CODES.TARGET_NOT_FOUND, "Choose a discovered destination."),
      };
    }

    return {
      accepted: false,
      error: failure(
        actor === "agent" ? FAILURE_CODES.TARGET_NOT_FOUND : FAILURE_CODES.INVALID_PHASE,
        requested === SCENES.RUINS
          ? "The relay must be restored before the ruins route is available."
          : requested === SCENES.CORE
            ? "The ruin door is still sealed."
            : "That route is not available from here.",
      ),
    };
  }

  private step(
    snapshot: GameSnapshot,
    command: GameCommand,
    actor: "human" | "agent" | "system",
  ): Transition {
    if (actor !== "human") {
      return {
        accepted: false,
        error: failure(
          FAILURE_CODES.INVALID_CONTEXT,
          "Only the human player can move one tile at a time.",
        ),
      };
    }
    if (snapshot.phase === PHASES.BATTLE || snapshot.phase === PHASES.COMPLETE) {
      return {
        accepted: false,
        error: failure(FAILURE_CODES.INVALID_PHASE, "Grid movement is unavailable in this phase."),
      };
    }
    const direction = normalizedDirection(command.direction);
    if (direction === null) {
      return {
        accepted: false,
        error: failure(FAILURE_CODES.INVALID_COMMAND, "STEP requires north, south, east, or west."),
      };
    }
    const delta =
      direction === "north"
        ? { x: 0, y: -1 }
        : direction === "south"
          ? { x: 0, y: 1 }
          : direction === "east"
            ? { x: 1, y: 0 }
            : { x: -1, y: 0 };
    return this.moveToPosition(
      snapshot,
      {
        type: "MOVE_TO_POSITION",
        position: {
          x: snapshot.position.x + delta.x,
          y: snapshot.position.y + delta.y,
        },
      },
      actor,
    );
  }

  private moveToPosition(
    snapshot: GameSnapshot,
    command: GameCommand,
    actor: "human" | "agent" | "system",
  ): Transition {
    if (actor !== "human") {
      return {
        accepted: false,
        error: failure(
          FAILURE_CODES.INVALID_CONTEXT,
          "Only the human player can choose an exact grid position.",
        ),
      };
    }
    if (snapshot.phase === PHASES.BATTLE || snapshot.phase === PHASES.COMPLETE) {
      return {
        accepted: false,
        error: failure(FAILURE_CODES.INVALID_PHASE, "Grid movement is unavailable in this phase."),
      };
    }
    const position = (command as { readonly position?: unknown }).position;
    if (!isValidGridPosition(position)) {
      return {
        accepted: false,
        error: failure(
          FAILURE_CODES.INVALID_POSITION,
          `Choose an integer position inside the ${GRID_WIDTH}x${GRID_HEIGHT} field.`,
          positionDetails(position),
        ),
      };
    }
    if (position.x === snapshot.position.x && position.y === snapshot.position.y) {
      return {
        accepted: true,
        snapshot,
        message: `Already at ${position.x}, ${position.y}.`,
      };
    }
    return {
      accepted: true,
      snapshot: this.normalizeSnapshot({ ...snapshot, position: { ...position } }),
      message: `Moved to ${position.x}, ${position.y}.`,
    };
  }

  private inspect(
    snapshot: GameSnapshot,
    command: GameCommand,
    actor: "human" | "agent" | "system",
  ): Transition {
    const target = targetOf(command) || normalized(snapshot.location);
    if (target === "maintenance_path" || target === "cyan_signal" || target === "ruin_signal") {
      if (!snapshot.puzzle.maintenancePathDiscovered) {
        if (actor !== "agent") {
          const proximity = proximityError(snapshot, target);
          if (proximity !== null) return { accepted: false, error: proximity };
        }
        return {
          accepted: false,
          error: failure(
            FAILURE_CODES.HUMAN_DISCOVERY_REQUIRED,
            actor === "agent"
              ? "The maintenance route must be discovered by a human first."
              : "Discover the cyan maintenance route by hand.",
          ),
        };
      }
      const error = proximityError(snapshot, target);
      return error === null
        ? {
            accepted: true,
            snapshot,
            message: "The shared cyan signal marks a maintenance route.",
          }
        : { accepted: false, error };
    }

    if (target.includes("door") || target === "ruins") {
      if (snapshot.location !== SCENES.RUINS) {
        return {
          accepted: false,
          error: failure(FAILURE_CODES.INVALID_LOCATION, "The ruin door is not here."),
        };
      }
      if (!snapshot.puzzle.rubbleCleared || !snapshot.puzzle.powerRestored) {
        return {
          accepted: false,
          error: failure(
            FAILURE_CODES.PUZZLE_ORDER,
            "Clear the rubble and restore power before inspecting the door.",
          ),
        };
      }
      const error = proximityError(snapshot, "ruin_door");
      if (error !== null) return { accepted: false, error };
      return {
        accepted: true,
        snapshot: this.normalizeSnapshot({
          ...snapshot,
          puzzle: {
            ...snapshot.puzzle,
            doorInspected: true,
            accessSigilRequired: true,
          },
        }),
        message: "The powered door requires an access sigil.",
      };
    }

    if (target === "voltyn_relay" || target === "relay" || target === "facility") {
      if (snapshot.location !== SCENES.RELAY) {
        return {
          accepted: false,
          error: failure(FAILURE_CODES.INVALID_LOCATION, "The Voltyn relay is not here."),
        };
      }
      const error = proximityError(snapshot, "voltyn_relay");
      if (error !== null) return { accepted: false, error };
      return {
        accepted: true,
        snapshot,
        message: snapshot.relay.restored
          ? "The Voltyn relay hums with a shared signal."
          : "The Voltyn relay is damaged and waiting for help.",
      };
    }

    const visibleTarget = snapshot.visibleTargets.find(
      (candidate) => normalized(candidate.id) === target && candidate.visible,
    );
    if (visibleTarget !== undefined) {
      const error = proximityError(snapshot, target);
      if (error !== null) return { accepted: false, error };
      return {
        accepted: true,
        snapshot,
        message: `${visibleTarget.label} is within reach.`,
      };
    }

    return {
      accepted: false,
      error: failure(FAILURE_CODES.TARGET_NOT_FOUND, "That object is not visible here."),
    };
  }

  private applyCapability(
    snapshot: GameSnapshot,
    command: GameCommand,
    actor: "human" | "agent" | "system",
    context: CommandContext,
  ): Transition {
    const capability = normalizeCapability(capabilityOf(command));
    if (capability === null) {
      return {
        accepted: false,
        error: failure(FAILURE_CODES.INVALID_COMMAND, "Choose ignite, break, or interface."),
      };
    }
    if (!snapshot.capabilities.includes(capability)) {
      return {
        accepted: false,
        error: failure(
          FAILURE_CODES.CAPABILITY_REQUIRED,
          `The party has not unlocked ${capability}.`,
          { capability },
        ),
      };
    }

    const actorId = normalizeWildGent(
      normalized(command.actorId ?? command.wildGentId ?? context.wildGentId ?? ""),
    );
    if (actorId !== null) {
      const member = snapshot.party.find((candidate) => candidate.id === actorId);
      if (member === undefined || !member.capabilities.includes(capability)) {
        return {
          accepted: false,
          error: failure(
            FAILURE_CODES.CAPABILITY_REQUIRED,
            `${actorId} cannot use ${capability}.`,
            { capability, actorId },
          ),
        };
      }
    }

    const target = targetOf(command) || normalized(snapshot.location);
    if (capability === CAPABILITIES.BREAK) {
      return this.applyBreak(snapshot, target, actor);
    }
    if (capability === CAPABILITIES.IGNITE) {
      return this.applyIgnite(snapshot, target);
    }
    return this.applyInterface(snapshot, target, actor);
  }

  private applyBreak(
    snapshot: GameSnapshot,
    target: string,
    actor: "human" | "agent" | "system",
  ): Transition {
    if (
      target === "voltyn_relay" ||
      target === "relay" ||
      target === "facility" ||
      target === "echo_beacon"
    ) {
      if (snapshot.location !== SCENES.RELAY) {
        return {
          accepted: false,
          error: failure(FAILURE_CODES.INVALID_LOCATION, "The damaged relay is not here."),
        };
      }
      const error = proximityError(snapshot, "voltyn_relay");
      if (error !== null) return { accepted: false, error };
      return this.restoreRelay(snapshot);
    }

    if (
      target === "ruin_rubble" ||
      target === "rubble" ||
      target === "ruins" ||
      target === "facility_ruins"
    ) {
      if (snapshot.location !== SCENES.RUINS) {
        return {
          accepted: false,
          error: failure(FAILURE_CODES.INVALID_LOCATION, "The ruin rubble is not here."),
        };
      }
      const error = proximityError(snapshot, "ruin_rubble");
      if (error !== null) return { accepted: false, error };
      if (snapshot.puzzle.rubbleCleared) {
        return {
          accepted: true,
          snapshot,
          message: "The ruin entrance is already clear.",
        };
      }
      return {
        accepted: true,
        snapshot: this.normalizeSnapshot({
          ...snapshot,
          phase: PHASES.RUINS,
          puzzle: puzzleStep({ ...snapshot.puzzle, rubbleCleared: true }, "rubble"),
        }),
        message: `${actor === "agent" ? "Echo" : "The party"} uses Grum's break to clear the ruin rubble.`,
      };
    }

    return {
      accepted: false,
      error: failure(FAILURE_CODES.TARGET_NOT_FOUND, "Break has no valid target here."),
    };
  }

  private applyIgnite(snapshot: GameSnapshot, target: string): Transition {
    if (target === "echo_beacon" || target === "beacon") {
      if (snapshot.location !== SCENES.RELAY && snapshot.location !== SCENES.CAMP) {
        return {
          accepted: false,
          error: failure(FAILURE_CODES.INVALID_LOCATION, "The Echo beacon is not here."),
        };
      }
      const error = proximityError(snapshot, "echo_beacon");
      if (error !== null) return { accepted: false, error };
      return {
        accepted: true,
        snapshot: this.normalizeSnapshot({ ...snapshot, beaconLit: true }),
        message: "Cindra calibrates the Echo beacon.",
      };
    }

    if (target === "voltyn_relay" || target === "relay" || target === "facility") {
      if (snapshot.location !== SCENES.RELAY) {
        return {
          accepted: false,
          error: failure(FAILURE_CODES.INVALID_LOCATION, "The relay is not here."),
        };
      }
      const error = proximityError(snapshot, "voltyn_relay");
      if (error !== null) return { accepted: false, error };
      const relay = {
        ...snapshot.relay,
        energyCellCharged: true,
      };
      return relay.housingCleared
        ? this.restoreRelay({ ...snapshot, relay })
        : {
            accepted: true,
            snapshot: this.normalizeSnapshot({ ...snapshot, relay }),
            message: "The relay's energy cell is charged; it still needs alignment.",
          };
    }

    if (target === "ruin_power" || target === "power" || target === "power_panel") {
      if (snapshot.location !== SCENES.RUINS) {
        return {
          accepted: false,
          error: failure(FAILURE_CODES.INVALID_LOCATION, "The ruin power panel is not here."),
        };
      }
      if (!snapshot.puzzle.rubbleCleared) {
        return {
          accepted: false,
          error: failure(
            FAILURE_CODES.PUZZLE_ORDER,
            "Clear the ruin rubble before restoring power.",
          ),
        };
      }
      const error = proximityError(snapshot, "ruin_power");
      if (error !== null) return { accepted: false, error };
      if (snapshot.puzzle.powerRestored) {
        return {
          accepted: true,
          snapshot,
          message: "The ruin power is already restored.",
        };
      }
      return {
        accepted: true,
        snapshot: this.normalizeSnapshot({
          ...snapshot,
          puzzle: puzzleStep({ ...snapshot.puzzle, powerRestored: true }, "power"),
        }),
        message: "Cindra ignites the ruin power panel.",
      };
    }

    return {
      accepted: false,
      error: failure(FAILURE_CODES.TARGET_NOT_FOUND, "Ignite has no valid target here."),
    };
  }

  private applyInterface(
    snapshot: GameSnapshot,
    target: string,
    actor: "human" | "agent" | "system",
  ): Transition {
    if (
      target === "ruin_door" ||
      target === "door" ||
      target === "powered_door" ||
      target === "ruins"
    ) {
      if (snapshot.location !== SCENES.RUINS) {
        return {
          accepted: false,
          error: failure(FAILURE_CODES.INVALID_LOCATION, "The ruin door is not here."),
        };
      }
      if (!snapshot.puzzle.rubbleCleared || !snapshot.puzzle.powerRestored) {
        return {
          accepted: false,
          error: failure(
            FAILURE_CODES.PUZZLE_ORDER,
            "Restore the ruin power before interfacing with the door.",
          ),
        };
      }
      const error = proximityError(snapshot, "ruin_door");
      if (error !== null) return { accepted: false, error };
      if (snapshot.puzzle.maintenancePathDiscovered) {
        return this.openDoor(snapshot, actor);
      }
      return {
        accepted: true,
        snapshot: this.normalizeSnapshot({
          ...snapshot,
          puzzle: {
            ...snapshot.puzzle,
            doorInspected: true,
            accessSigilRequired: true,
          },
        }),
        message:
          "Interface reveals an access-sigil lock; a human must discover the maintenance route.",
      };
    }

    if (target === "voltyn_relay" || target === "relay") {
      if (!snapshot.relay.restored) {
        return {
          accepted: false,
          error: failure(FAILURE_CODES.PUZZLE_ORDER, "Restore the relay before using interface."),
        };
      }
      const error = proximityError(snapshot, "voltyn_relay");
      if (error !== null) return { accepted: false, error };
      return {
        accepted: true,
        snapshot,
        message: "Interface reads the restored Voltyn relay.",
      };
    }

    return {
      accepted: false,
      error: failure(FAILURE_CODES.TARGET_NOT_FOUND, "Interface has no valid target here."),
    };
  }

  private restoreRelay(snapshot: GameSnapshot): Transition {
    if (snapshot.location !== SCENES.RELAY) {
      return {
        accepted: false,
        error: failure(FAILURE_CODES.INVALID_LOCATION, "The Voltyn relay is not here."),
      };
    }
    const proximity = proximityError(snapshot, "voltyn_relay");
    if (proximity !== null) return { accepted: false, error: proximity };
    if (snapshot.relay.restored && snapshot.resonance.occurred) {
      return {
        accepted: true,
        snapshot,
        message: "Voltyn Resonance is already active.",
      };
    }

    const voltyn = {
      id: WILD_GENTS.VOLTYN,
      name: "Voltyn",
      role: "resonant" as const,
      capabilities: [CAPABILITIES.INTERFACE] as const,
      maxHp: 20,
      hp: 20,
      attack: 2,
      signatureDamage: 6,
      signatureUsed: false,
      active: false,
    };
    const party = snapshot.party.some((member) => member.id === WILD_GENTS.VOLTYN)
      ? snapshot.party
      : [...snapshot.party, voltyn];
    return {
      accepted: true,
      snapshot: this.normalizeSnapshot({
        ...snapshot,
        phase: PHASES.RELAY,
        scene: SCENES.RELAY,
        currentScene: SCENES.RELAY,
        location: SCENES.RELAY,
        position: { x: 5, y: 2 },
        relay: relayComplete(snapshot.relay),
        party,
        capabilities: unique([...snapshot.capabilities, CAPABILITIES.INTERFACE]),
        unlockedCapabilities: unique([...snapshot.unlockedCapabilities, CAPABILITIES.INTERFACE]),
        resonance: {
          occurred: true,
          wildGentId: WILD_GENTS.VOLTYN,
          unlockedCapability: CAPABILITIES.INTERFACE,
        },
        voltynResonance: true,
        checkpoint: {
          available: true,
          label: "resonance",
          snapshot: null,
        },
      }),
      message: "The relay is restored. VOLTYN RESONANCE unlocks interface.",
    };
  }

  private discover(
    snapshot: GameSnapshot,
    command: GameCommand,
    actor: "human" | "agent" | "system",
  ): Transition {
    if (actor === "agent") {
      return {
        accepted: false,
        error: failure(
          FAILURE_CODES.HUMAN_DISCOVERY_REQUIRED,
          "Echo cannot discover the hidden maintenance route; a human must find it.",
        ),
      };
    }
    const target = targetOf(command) || "maintenance_path";
    if (target !== "maintenance_path" && target !== "cyan_signal" && target !== "ruin_signal") {
      return {
        accepted: false,
        error: failure(FAILURE_CODES.TARGET_NOT_FOUND, "That discovery is not available here."),
      };
    }
    if (snapshot.location !== SCENES.RUINS) {
      return {
        accepted: false,
        error: failure(
          FAILURE_CODES.INVALID_LOCATION,
          "The cyan maintenance route is in the ruins.",
        ),
      };
    }
    if (!snapshot.puzzle.doorInspected) {
      return {
        accepted: false,
        error: failure(
          FAILURE_CODES.PUZZLE_ORDER,
          "Inspect the powered door before following its signal.",
        ),
      };
    }
    const error = proximityError(snapshot, target);
    if (error !== null) return { accepted: false, error };
    if (snapshot.puzzle.maintenancePathDiscovered) {
      return {
        accepted: true,
        snapshot,
        message: "The cyan maintenance route is already shared with Echo.",
      };
    }
    return {
      accepted: true,
      snapshot: this.normalizeSnapshot({
        ...snapshot,
        puzzle: {
          ...snapshot.puzzle,
          maintenancePathDiscovered: true,
        },
        checkpoint: {
          available: true,
          label: "discovery",
          snapshot: null,
        },
      }),
      message: "Human discovery shared the cyan maintenance route with Echo.",
    };
  }

  private setDirective(
    snapshot: GameSnapshot,
    command: GameCommand,
    actor: "human" | "agent" | "system",
  ): Transition {
    if (actor === "agent") {
      return {
        accepted: false,
        error: failure(
          FAILURE_CODES.DIRECTIVE_BLOCKED,
          "Avoid battles is human-owned and Echo cannot change it.",
        ),
      };
    }
    const directive = normalizeDirective(
      normalized(command.directive ?? command.targetId ?? command.target ?? command.type),
    );
    if (directive !== DIRECTIVES.AVOID_BATTLES) {
      return {
        accepted: false,
        error: failure(FAILURE_CODES.INVALID_COMMAND, "The only MVP directive is Avoid battles."),
      };
    }
    const active = command.active ?? true;
    return {
      accepted: true,
      snapshot: this.normalizeSnapshot({
        ...snapshot,
        directives: {
          ...snapshot.directives,
          avoidBattles: active,
          active: active ? [DIRECTIVES.AVOID_BATTLES] : [],
        },
        humanDirectives: active ? [DIRECTIVES.AVOID_BATTLES] : [],
      }),
      message: active
        ? "Human directive set: Avoid battles."
        : "Human directive cleared: Avoid battles.",
    };
  }

  private startBattle(snapshot: GameSnapshot, actor: "human" | "agent" | "system"): Transition {
    if (snapshot.directives.avoidBattles && actor === "agent") {
      return {
        accepted: false,
        error: failure(
          FAILURE_CODES.DIRECTIVE_BLOCKED,
          "Echo refuses to initiate combat while Avoid battles is active.",
        ),
      };
    }
    if (snapshot.phase !== PHASES.BATTLE || snapshot.battle === null) {
      return {
        accepted: false,
        error: failure(FAILURE_CODES.BATTLE_REQUIRED, "There is no guardian encounter to start."),
      };
    }
    if (snapshot.battle.status === "active") {
      return {
        accepted: true,
        snapshot,
        message: "The guardian battle is already active.",
      };
    }
    if (snapshot.battle.status !== "encounter") {
      return {
        accepted: false,
        error: failure(FAILURE_CODES.BATTLE_NOT_ACTIVE, "The guardian encounter has ended."),
      };
    }
    return {
      accepted: true,
      snapshot: this.normalizeSnapshot({
        ...snapshot,
        position: { x: 7, y: 4 },
        battle: {
          ...snapshot.battle,
          status: "active",
          turn: 1,
          turnOwner: actor,
          log: [
            ...snapshot.battle.log,
            {
              turn: 1,
              actor,
              action: "encounter",
              sourceId: WILD_GENTS.WARPED_GUARDIAN,
              message: `${actor === "agent" ? "Echo" : "The player"} accepts the guardian battle.`,
            },
          ],
        },
      }),
      message: "The deterministic guardian battle begins.",
    };
  }

  private battleAction(
    snapshot: GameSnapshot,
    command: GameCommand,
    actor: "human" | "agent" | "system",
  ): Transition {
    if (snapshot.directives.avoidBattles && actor === "agent") {
      return {
        accepted: false,
        error: failure(
          FAILURE_CODES.DIRECTIVE_BLOCKED,
          "Echo will not take a combat action while Avoid battles is active.",
        ),
      };
    }
    const battle = snapshot.battle;
    if (snapshot.phase !== PHASES.BATTLE || battle === null) {
      return {
        accepted: false,
        error: failure(FAILURE_CODES.NO_ACTIVE_BATTLE, "No guardian battle is active."),
      };
    }
    // The WebMCP contract intentionally exposes one battle_action tool. Starting an encounter
    // and taking the first move therefore share one public call; the manual adapter may still
    // send an explicit START_BATTLE followed by BATTLE_ACTION.
    if (battle.status === "encounter") {
      const started = this.startBattle(snapshot, actor);
      return started.accepted ? this.battleAction(started.snapshot, command, actor) : started;
    }
    if (battle.status !== "active") {
      return {
        accepted: false,
        error: failure(FAILURE_CODES.BATTLE_NOT_ACTIVE, "Start the guardian battle first."),
      };
    }
    if (battle.turnOwner !== actor && actor !== "system") {
      return {
        accepted: false,
        error: failure(FAILURE_CODES.BATTLE_TURN, `It is ${battle.turnOwner}'s turn.`),
      };
    }
    const action = battleActionOf(command);
    if (action === null) {
      return {
        accepted: false,
        error: failure(
          FAILURE_CODES.INVALID_BATTLE_ACTION,
          "Choose strike, defend, signature, switch, or environmental.",
        ),
      };
    }

    if (action === BATTLE_ACTIONS.SWITCH) {
      const requested = normalizeWildGent(
        normalized(command.actorId ?? command.wildGentId ?? targetOf(command)),
      );
      if (requested === null || requested === WILD_GENTS.WARPED_GUARDIAN) {
        return {
          accepted: false,
          error: failure(FAILURE_CODES.INVALID_BATTLE_ACTION, "Switch requires a party WildGent."),
        };
      }
      const member = snapshot.party.find((candidate) => candidate.id === requested);
      if (member === undefined) {
        return {
          accepted: false,
          error: failure(FAILURE_CODES.INVALID_BATTLE_ACTION, "That WildGent is not in the party."),
        };
      }
      return this.resolveBattleTurn(
        snapshot,
        actor,
        action,
        requested,
        0,
        `Switched to ${member.name}.`,
      );
    }

    const active = snapshot.party.find((member) => member.id === battle.activeWildGentId);
    if (active === undefined) {
      return {
        accepted: false,
        error: failure(FAILURE_CODES.INVALID_BATTLE_ACTION, "The active WildGent is unavailable."),
      };
    }
    if (action === BATTLE_ACTIONS.SIGNATURE && active.signatureUsed) {
      return {
        accepted: false,
        error: failure(
          FAILURE_CODES.SIGNATURE_ALREADY_USED,
          `${active.name}'s signature has already been used.`,
        ),
      };
    }
    if (action === BATTLE_ACTIONS.ENVIRONMENTAL && battle.environmentalUsed) {
      return {
        accepted: false,
        error: failure(
          FAILURE_CODES.INVALID_BATTLE_ACTION,
          "The relay conduit has already discharged.",
        ),
      };
    }
    if (action === BATTLE_ACTIONS.ENVIRONMENTAL && !snapshot.partyIds.includes(WILD_GENTS.VOLTYN)) {
      return {
        accepted: false,
        error: failure(
          FAILURE_CODES.CAPABILITY_REQUIRED,
          "Voltyn's interface is required for the conduit action.",
        ),
      };
    }

    const damage =
      action === BATTLE_ACTIONS.STRIKE
        ? active.attack
        : action === BATTLE_ACTIONS.SIGNATURE
          ? active.signatureDamage
          : action === BATTLE_ACTIONS.ENVIRONMENTAL
            ? 4
            : 0;
    return this.resolveBattleTurn(
      snapshot,
      actor,
      action,
      active.id,
      damage,
      action === BATTLE_ACTIONS.DEFEND
        ? `${active.name} braces for the guardian's counter.`
        : `${active.name} uses ${action} for ${damage} damage.`,
    );
  }

  private resolveBattleTurn(
    snapshot: GameSnapshot,
    actor: "human" | "agent" | "system",
    action: BattleAction,
    sourceId: WildGentId,
    damage: number,
    message: string,
  ): Transition {
    const battle = snapshot.battle;
    if (battle === null) {
      return {
        accepted: false,
        error: failure(FAILURE_CODES.NO_ACTIVE_BATTLE, "No guardian battle is active."),
      };
    }
    const turn = battle.turn;
    const afterHit = Math.max(0, battle.guardianHp - damage);
    const party = snapshot.party.map((member) =>
      member.id === sourceId && action === BATTLE_ACTIONS.SIGNATURE
        ? { ...member, signatureUsed: true }
        : member.id === sourceId && action === BATTLE_ACTIONS.SWITCH
          ? { ...member, active: true }
          : member.id !== sourceId && action === BATTLE_ACTIONS.SWITCH
            ? { ...member, active: false }
            : member,
    );
    const actionLog: BattleLogEntry = {
      turn,
      actor,
      action,
      sourceId,
      ...(damage > 0 ? { damage } : {}),
      message,
    };
    if (afterHit === 0) {
      const wonBattle: BattleState = {
        ...battle,
        status: "won",
        guardianHp: 0,
        turn: turn + 1,
        defending: false,
        environmentalUsed: battle.environmentalUsed || action === BATTLE_ACTIONS.ENVIRONMENTAL,
        log: [
          ...battle.log,
          actionLog,
          {
            turn: turn + 1,
            actor: "system",
            action: "victory",
            sourceId: WILD_GENTS.WARPED_GUARDIAN,
            message: "The guardian collapses. The Ancient Core is reachable.",
          },
        ],
      };
      return {
        accepted: true,
        snapshot: this.normalizeSnapshot({
          ...snapshot,
          phase: PHASES.CORE,
          scene: SCENES.CORE,
          currentScene: SCENES.CORE,
          location: SCENES.CORE,
          position: { x: 7, y: 4 },
          party,
          battle: wonBattle,
          checkpoint: {
            available: true,
            label: "battle",
            snapshot: null,
          },
        }),
        message: "Guardian defeated. The Ancient Core shines through.",
      };
    }

    const incoming = action === BATTLE_ACTIONS.DEFEND ? 1 : 2;
    const playerHp = Math.max(0, battle.playerHp - incoming);
    const defeated = playerHp === 0;
    const nextBattle: BattleState = {
      ...battle,
      status: defeated ? "lost" : "active",
      guardianHp: afterHit,
      playerHp,
      activeWildGentId: sourceId,
      turn: turn + 1,
      defending: false,
      environmentalUsed: battle.environmentalUsed || action === BATTLE_ACTIONS.ENVIRONMENTAL,
      log: [
        ...battle.log,
        actionLog,
        {
          turn: turn + 1,
          actor: "system",
          action: "counter",
          sourceId: WILD_GENTS.WARPED_GUARDIAN,
          damage: incoming,
          message: defeated
            ? "The guardian's counter ends the encounter."
            : `The guardian counters for ${incoming} damage.`,
        },
        ...(defeated
          ? [
              {
                turn: turn + 1,
                actor: "system" as const,
                action: "defeat" as const,
                sourceId: WILD_GENTS.WARPED_GUARDIAN,
                message: "The party falls back to the last checkpoint.",
              },
            ]
          : []),
      ],
    };
    return {
      accepted: true,
      snapshot: this.normalizeSnapshot({
        ...snapshot,
        position: { x: 7, y: 4 },
        party,
        battle: nextBattle,
      }),
      message: defeated ? "The guardian wins this exchange." : message,
    };
  }

  private enterCore(snapshot: GameSnapshot, actor: "human" | "agent" | "system"): Transition {
    if (!snapshot.puzzle.doorOpened) {
      return {
        accepted: false,
        error: failure(FAILURE_CODES.ACCESS_SIGIL_REQUIRED, "The ruin door is still sealed."),
      };
    }
    if (snapshot.battle === null) {
      return {
        accepted: false,
        error: failure(FAILURE_CODES.BATTLE_REQUIRED, "The guardian encounter has not appeared."),
      };
    }
    return {
      accepted: true,
      snapshot: this.normalizeSnapshot({
        ...snapshot,
        phase: PHASES.BATTLE,
        scene: SCENES.CORE,
        currentScene: SCENES.CORE,
        location: SCENES.CORE,
        position: { x: 7, y: 4 },
      }),
      message:
        actor === "agent"
          ? "Echo enters the Ancient Core chamber."
          : "The party enters the Ancient Core chamber.",
    };
  }

  private openDoor(snapshot: GameSnapshot, actor: "human" | "agent" | "system"): Transition {
    if (snapshot.location !== SCENES.RUINS) {
      return {
        accepted: false,
        error: failure(FAILURE_CODES.INVALID_LOCATION, "The ruin door is not here."),
      };
    }
    if (!snapshot.puzzle.doorInspected || !snapshot.puzzle.accessSigilRequired) {
      return {
        accepted: false,
        error: failure(
          FAILURE_CODES.PUZZLE_ORDER,
          "Interface with the powered door before opening it.",
        ),
      };
    }
    if (!snapshot.puzzle.maintenancePathDiscovered) {
      return {
        accepted: false,
        error: failure(
          FAILURE_CODES.HUMAN_DISCOVERY_REQUIRED,
          "A human must discover the cyan maintenance route before Echo can open the door.",
        ),
      };
    }
    const proximity = proximityError(snapshot, "ruin_door");
    if (proximity !== null) return { accepted: false, error: proximity };
    if (snapshot.puzzle.doorOpened) {
      return {
        accepted: true,
        snapshot,
        message: "The ruin door is already open.",
      };
    }
    return {
      accepted: true,
      snapshot: this.normalizeSnapshot({
        ...snapshot,
        phase: PHASES.BATTLE,
        scene: SCENES.CORE,
        currentScene: SCENES.CORE,
        location: SCENES.CORE,
        position: { x: 7, y: 4 },
        puzzle: {
          ...snapshot.puzzle,
          doorOpened: true,
        },
        battle: initialBattle(snapshot.activeWildGentId),
      }),
      message: `${actor === "agent" ? "Echo" : "The party"} opens the ruin. A guardian appears.`,
    };
  }

  private claimCore(snapshot: GameSnapshot): Transition {
    if (snapshot.phase !== PHASES.CORE || snapshot.battle?.status !== "won") {
      return {
        accepted: false,
        error: failure(
          FAILURE_CODES.CORE_NOT_REACHED,
          "Defeat the guardian before claiming the Ancient Core.",
        ),
      };
    }
    const error = proximityError(snapshot, "ancient_core");
    if (error !== null) return { accepted: false, error };
    if (snapshot.ancientCoreClaimed) {
      return {
        accepted: true,
        snapshot,
        message: "The Ancient Core is already resonating with the party.",
      };
    }
    return {
      accepted: true,
      snapshot: this.normalizeSnapshot({
        ...snapshot,
        phase: PHASES.COMPLETE,
        ancientCoreClaimed: true,
        completed: true,
        checkpoint: {
          available: true,
          label: "complete",
          snapshot: null,
        },
      }),
      message: "The Ancient Core answers. Journey complete.",
    };
  }
}

export const createGameEngine = (
  options: import("./types").GameEngineOptions = {},
): WildGentGameEngine => new WildGentGameEngine(options);

export const createEngine = createGameEngine;
