export type ZoneId = "camp" | "ruins" | "core";

export type Phase = "preflight" | "journey" | "battle" | "complete";

export type CharacterId = "cindra" | "grum" | "voltyn" | "guardian";

export type PartySkillId = "ignite" | "break" | "interface";

export type LandmarkId =
  | "camp-beacon"
  | "relay-station"
  | "ruins-rubble"
  | "ruins-power"
  | "ruins-sigil"
  | "ruins-vines"
  | "ancient-core";

export type Point = { x: number; y: number };
export type GridPosition = Point;
export type CardinalDirection = "north" | "south" | "east" | "west";

export type ActivityKind = "system" | "human" | "echo" | "discovery" | "battle";

export type ActivityEvent = {
  id: string;
  kind: ActivityKind;
  label: string;
  detail: string;
  timestamp: number;
  actor?: "human" | "echo" | "system";
  commandType?: string;
  accepted?: boolean;
};

export type Flags = {
  beaconLit: boolean;
  resonanceCalibrated: boolean;
  rubbleCleared: boolean;
  powerRestored: boolean;
  sigilRead: boolean;
  vinesDiscovered: boolean;
  guardianDefeated: boolean;
  coreEntered: boolean;
};

export type EchoState = {
  connected: boolean;
  signalFound: boolean;
  message: string;
  confidence: number;
};

export type BattleState = {
  enemy: CharacterId;
  enemyName: string;
  enemyHp: number;
  enemyMaxHp: number;
  playerHp: number;
  playerMaxHp: number;
  turn: "player" | "guardian" | "won";
  lastMove: string;
};

export type GameSnapshot = {
  version: number;
  phase: Phase;
  zone: ZoneId;
  position: Point;
  flags: Flags;
  directives: { avoidBattles: boolean };
  echo: EchoState;
  battle: BattleState | null;
  activity: ActivityEvent[];
  selectedLandmark: LandmarkId | null;
};

export type GameAction =
  | { type: "START_JOURNEY" }
  | { type: "START_DEMO" }
  | { type: "MOVE_STEP"; direction: CardinalDirection }
  | { type: "MOVE_TO"; position: GridPosition; landmark?: LandmarkId }
  | { type: "TRAVEL_TO"; zone: ZoneId }
  | { type: "INTERACT"; landmark: LandmarkId }
  | { type: "DISCOVER_SIGNAL" }
  | { type: "SET_DIRECTIVE"; directive: "avoid-battles"; active: boolean }
  | { type: "ATTACK"; move: "resonance" | "guard" | "pulse" | "environment" }
  | { type: "ENTER_CORE" }
  | { type: "RESET"; mode?: "journey" | "demo" };

export type LandmarkContent = {
  id: LandmarkId;
  zone: ZoneId;
  label: string;
  shortLabel: string;
  description: string;
  actionLabel: string;
  position: Point;
  requirement?: string;
  available: (snapshot: GameSnapshot) => boolean;
  complete: (snapshot: GameSnapshot) => boolean;
};

export type ZoneContent = {
  id: ZoneId;
  title: string;
  subtitle: string;
  objective: string;
  camera: { x: number; y: number; z: number };
  landmarks: LandmarkContent[];
};

export type LandmarkActionState = "locked" | "approach" | "ready" | "complete";

export type LandmarkActionResolution = {
  state: LandmarkActionState;
  position: GridPosition;
  label: string;
  hint: string;
};

export type PartySkillState = "ready" | "active" | "locked";

export type PartySkill = {
  id: PartySkillId;
  character: Exclude<CharacterId, "guardian">;
  label: string;
  detail: string;
};

export const PARTY_SKILLS: readonly PartySkill[] = [
  {
    id: "ignite",
    character: "cindra",
    label: "Cindra Ignite",
    detail: "Activate resonance signals",
  },
  { id: "break", character: "grum", label: "Grum Break", detail: "Clear blocked paths" },
  {
    id: "interface",
    character: "voltyn",
    label: "Voltyn Interface",
    detail: "Awaken ancient technology",
  },
];

export const partySkillStateFor = (
  skill: PartySkillId,
  snapshot: GameSnapshot,
): PartySkillState => {
  if (skill === "interface" && !snapshot.flags.resonanceCalibrated) return "locked";
  if (skill === "ignite") return snapshot.flags.resonanceCalibrated ? "active" : "ready";
  if (skill === "break") return snapshot.flags.rubbleCleared ? "active" : "ready";
  return "ready";
};

export const unlockedPartySkillCountFor = (snapshot: GameSnapshot): number =>
  PARTY_SKILLS.filter(({ id }) => partySkillStateFor(id, snapshot) !== "locked").length;

export type ObjectiveState = {
  id:
    | "complete"
    | "battle"
    | "beacon"
    | "resonance"
    | "travel"
    | "rubble"
    | "power"
    | "sigil"
    | "human-discovery"
    | "return-sigil"
    | "guardian"
    | "core";
  title: string;
  detail: string;
};

const always = () => true;

export const INITIAL_FLAGS: Flags = {
  beaconLit: false,
  resonanceCalibrated: false,
  rubbleCleared: false,
  powerRestored: false,
  sigilRead: false,
  vinesDiscovered: false,
  guardianDefeated: false,
  coreEntered: false,
};

export const INITIAL_SNAPSHOT: GameSnapshot = {
  version: 0,
  phase: "preflight",
  zone: "camp",
  position: { x: 1, y: 1 },
  flags: INITIAL_FLAGS,
  directives: { avoidBattles: false },
  echo: {
    connected: true,
    signalFound: false,
    message: "Awaiting a human-found signal.",
    confidence: 0,
  },
  battle: null,
  activity: [
    {
      id: "boot",
      kind: "system",
      label: "Field kit ready",
      detail: "The map is local. Echo is listening.",
      timestamp: Date.now(),
    },
  ],
  selectedLandmark: "camp-beacon",
};

export const ZONE_CONTENT: Record<ZoneId, ZoneContent> = {
  camp: {
    id: "camp",
    title: "Camp / relay",
    subtitle: "Where the canopy opens to a patient signal",
    objective: "Light the beacon, then walk the relay path.",
    camera: { x: 0, y: 11, z: 13 },
    landmarks: [
      {
        id: "camp-beacon",
        zone: "camp",
        label: "Camp beacon",
        shortLabel: "Beacon",
        description: "A cold field beacon waits beside the first fire ring.",
        actionLabel: "Light beacon",
        position: { x: 1, y: 1 },
        available: always,
        complete: (snapshot) => snapshot.flags.beaconLit,
      },
      {
        id: "relay-station",
        zone: "camp",
        label: "Resonance relay",
        shortLabel: "Relay",
        description: "A copper relay repeats whatever the living canopy gives it.",
        actionLabel: "Calibrate Resonance",
        position: { x: 5, y: 2 },
        requirement: "Light the beacon first.",
        available: (snapshot) => snapshot.flags.beaconLit,
        complete: (snapshot) => snapshot.flags.resonanceCalibrated,
      },
    ],
  },
  ruins: {
    id: "ruins",
    title: "Ruins / guardian",
    subtitle: "A broken observatory under fern and stone",
    objective: "Clear the rubble, restore power, and read the sigil.",
    camera: { x: 0, y: 10, z: 14 },
    landmarks: [
      {
        id: "ruins-rubble",
        zone: "ruins",
        label: "Collapsed rubble",
        shortLabel: "Rubble",
        description: "Basalt slabs pin the old observatory door shut.",
        actionLabel: "Clear rubble",
        position: { x: 2, y: 2 },
        requirement: "Reach the ruins after calibrating Resonance.",
        available: (snapshot) => snapshot.flags.resonanceCalibrated,
        complete: (snapshot) => snapshot.flags.rubbleCleared,
      },
      {
        id: "ruins-power",
        zone: "ruins",
        label: "Power cradle",
        shortLabel: "Power",
        description: "A dormant cradle has one clean socket left in its copper ribs.",
        actionLabel: "Restore power",
        position: { x: 5, y: 3 },
        requirement: "Clear the collapsed rubble.",
        available: (snapshot) => snapshot.flags.rubbleCleared,
        complete: (snapshot) => snapshot.flags.powerRestored,
      },
      {
        id: "ruins-sigil",
        zone: "ruins",
        label: "Moss sigil",
        shortLabel: "Sigil",
        description: "The observatory's promise is cut into a stone plate.",
        actionLabel: "Read sigil",
        position: { x: 7, y: 6 },
        requirement: "Restore the power cradle.",
        available: (snapshot) => snapshot.flags.powerRestored,
        complete: (snapshot) => snapshot.flags.sigilRead,
      },
      {
        id: "ruins-vines",
        zone: "ruins",
        label: "Signal vines",
        shortLabel: "Vines",
        description: "A cyan thread is hidden in the vines. Only a human hand can find it.",
        actionLabel: "Trace signal by hand",
        position: { x: 8, y: 2 },
        requirement: "Click the cyan signal in the vines.",
        available: (snapshot) => snapshot.flags.sigilRead,
        complete: (snapshot) => snapshot.flags.vinesDiscovered,
      },
    ],
  },
  core: {
    id: "core",
    title: "Ancient core",
    subtitle: "A quiet chamber where the signal becomes a choice",
    objective: "Face the guardian, then enter the core.",
    camera: { x: 0, y: 9, z: 12 },
    landmarks: [
      {
        id: "ancient-core",
        zone: "core",
        label: "Ancient core",
        shortLabel: "Core",
        description: "The old heart of the forest waits behind the guardian's oath.",
        actionLabel: "Enter ancient core",
        position: { x: 4, y: 4 },
        requirement: "Defeat the guardian.",
        available: (snapshot) => snapshot.flags.guardianDefeated,
        complete: (snapshot) => snapshot.flags.coreEntered,
      },
    ],
  },
};

export const CHARACTERS: Record<CharacterId, { name: string; color: number; role: string }> = {
  cindra: { name: "Cindra", color: 0xe36c4f, role: "ember scout" },
  grum: { name: "Grum", color: 0x876a4f, role: "mossback carrier" },
  voltyn: { name: "Voltyn", color: 0x52c8d9, role: "signal moth" },
  guardian: { name: "The Rootbound Guardian", color: 0xbca36c, role: "ancient sentinel" },
};

export const ACTION_LABELS: Record<GameAction["type"], string> = {
  START_JOURNEY: "Begin journey",
  START_DEMO: "Start judge demo",
  MOVE_STEP: "Move",
  MOVE_TO: "Move",
  TRAVEL_TO: "Travel",
  INTERACT: "Interact",
  DISCOVER_SIGNAL: "Trace signal by hand",
  ATTACK: "Take action",
  ENTER_CORE: "Enter core",
  SET_DIRECTIVE: "Set directive",
  RESET: "Reset expedition",
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};

const asBoolean = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;

const asNumber = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asString = (value: unknown, fallback: string) =>
  typeof value === "string" ? value : fallback;

const DEFAULT_POSITION: GridPosition = { x: 1, y: 1 };

const normalizePosition = (value: unknown): GridPosition => {
  const candidate = asRecord(value);
  const x = candidate.x;
  const y = candidate.y;
  if (
    typeof x === "number" &&
    Number.isInteger(x) &&
    x >= 0 &&
    x < 10 &&
    typeof y === "number" &&
    Number.isInteger(y) &&
    y >= 0 &&
    y < 7
  ) {
    return { x, y };
  }
  return { ...DEFAULT_POSITION };
};

const normalizeZone = (value: unknown): ZoneId => {
  if (value === "camp" || value === "ruins" || value === "core") return value;
  if (value === "relay" || value === "facility") return "camp";
  if (value === "ancient-core" || value === "ancientCore") return "core";
  return "camp";
};

const normalizePhase = (
  value: unknown,
  root: Record<string, unknown>,
  battle: Record<string, unknown> | null,
): Phase => {
  if (value === "preflight" || value === "journey" || value === "complete") return value;
  if (value === "explore" || value === "travel") return "journey";
  if (value === "battle") return battle?.status === "won" ? "journey" : "battle";
  if (value === "core") return battle?.status === "won" ? "journey" : "battle";
  if (value === "camp" || value === "relay" || value === "ruins") {
    const activity = Array.isArray(root.activity) ? root.activity : [];
    return asNumber(root.version, 0) === 0 && activity.length === 0 ? "preflight" : "journey";
  }
  return "preflight";
};

const normalizeLandmark = (value: unknown): LandmarkId | null => {
  if (
    value === "camp-beacon" ||
    value === "relay-station" ||
    value === "ruins-rubble" ||
    value === "ruins-power" ||
    value === "ruins-sigil" ||
    value === "ruins-vines" ||
    value === "ancient-core"
  ) {
    return value;
  }
  return null;
};

const normalizeActivity = (value: unknown): ActivityEvent[] => {
  if (!Array.isArray(value)) return INITIAL_SNAPSHOT.activity;
  return value.slice(-12).map((item, index) => {
    const record = asRecord(item);
    const kind = record.kind;
    const command = asString(record.commandType ?? record.command, "").toLowerCase();
    const actor = asString(record.actor, "").toLowerCase();
    return {
      id: asString(record.id, `event-${index}`),
      kind:
        kind === "human" || kind === "echo" || kind === "discovery" || kind === "battle"
          ? kind
          : command.includes("discover")
            ? "discovery"
            : command.includes("battle") || command.includes("strike") || command.includes("defend")
              ? "battle"
              : actor === "human" || actor === "player"
                ? "human"
                : actor === "agent" || actor === "echo"
                  ? "echo"
                  : "system",
      label: asString(record.label ?? record.title ?? record.commandType, "Field note"),
      detail: asString(record.detail ?? record.message, "The expedition state changed."),
      timestamp: asNumber(record.timestamp, Date.now()),
      actor:
        actor === "human" || actor === "player"
          ? "human"
          : actor === "agent" || actor === "echo"
            ? "echo"
            : "system",
      commandType: command,
      accepted: record.kind !== "refused",
    };
  });
};

/**
 * The app owns the presentation projection only. The engine snapshot remains the source of truth;
 * this function merely tolerates the engine's evolving wire vocabulary while the package settles.
 */
export const normalizeSnapshot = (input: unknown): GameSnapshot => {
  const source = asRecord(input);
  const nestedState = asRecord(source.state);
  const root = Object.keys(nestedState).length > 0 ? nestedState : source;
  const rootFlags = asRecord(root.flags ?? root.progress);
  const rootEcho = asRecord(root.echo ?? root.signal);
  const rootBattle = root.battle === null ? null : asRecord(root.battle);
  const position = asRecord(root.position ?? root.playerPosition ?? root.player);
  const relay = asRecord(root.relay);
  const resonance = asRecord(root.resonance);
  const puzzle = asRecord(root.puzzle);
  const directives = asRecord(root.directives);
  const activity = normalizeActivity(root.activity ?? root.events ?? root.log);
  const flags: Flags = {
    beaconLit:
      asBoolean(root.beaconLit, false) || asBoolean(rootFlags.beaconLit ?? rootFlags.beacon, false),
    resonanceCalibrated:
      asBoolean(rootFlags.resonanceCalibrated ?? rootFlags.resonance ?? rootFlags.relay, false) ||
      asBoolean(relay.restored, false) ||
      asBoolean(resonance.occurred, false) ||
      asBoolean(root.voltynResonance, false),
    rubbleCleared:
      asBoolean(rootFlags.rubbleCleared ?? rootFlags.rubble, false) ||
      asBoolean(puzzle.rubbleCleared, false),
    powerRestored:
      asBoolean(rootFlags.powerRestored ?? rootFlags.power, false) ||
      asBoolean(puzzle.powerRestored, false),
    sigilRead:
      asBoolean(rootFlags.sigilRead ?? rootFlags.sigil, false) ||
      asBoolean(puzzle.doorInspected, false) ||
      asBoolean(puzzle.doorOpened, false),
    vinesDiscovered:
      asBoolean(rootFlags.vinesDiscovered ?? rootFlags.vines, false) ||
      asBoolean(puzzle.maintenancePathDiscovered, false),
    guardianDefeated:
      asBoolean(rootFlags.guardianDefeated ?? rootFlags.guardian, false) ||
      asString(rootBattle?.status, "") === "won",
    coreEntered:
      asBoolean(rootFlags.coreEntered ?? rootFlags.core, false) ||
      asBoolean(root.ancientCoreClaimed, false),
  };
  const battle =
    rootBattle && Object.keys(rootBattle).length > 0
      ? {
          enemy: "guardian" as const,
          enemyName:
            asString(rootBattle.enemyName, "") ||
            (asString(rootBattle.guardianId ?? rootBattle.enemy, "") === "warped-guardian"
              ? "The Rootbound Guardian"
              : "The Rootbound Guardian"),
          enemyHp: asNumber(
            rootBattle.enemyHp ?? rootBattle.guardianHp ?? rootBattle.opponentHp,
            18,
          ),
          enemyMaxHp: asNumber(
            rootBattle.enemyMaxHp ?? rootBattle.guardianMaxHp ?? rootBattle.opponentMaxHp,
            18,
          ),
          playerHp: asNumber(rootBattle.playerHp ?? rootBattle.hp, 18),
          playerMaxHp: asNumber(rootBattle.playerMaxHp ?? rootBattle.maxHp, 18),
          turn: (rootBattle.status === "won"
            ? "won"
            : rootBattle.turnOwner === "agent" || rootBattle.turnOwner === "guardian"
              ? "guardian"
              : "player") as BattleState["turn"],
          lastMove: (() => {
            const log = Array.isArray(rootBattle.log) ? rootBattle.log : [];
            const last = asRecord(log.at(-1));
            return asString(
              rootBattle.lastMove ?? rootBattle.lastAction ?? last.message,
              "The guardian watches.",
            );
          })(),
        }
      : null;

  return {
    version: asNumber(root.version, 0),
    phase: normalizePhase(root.phase, root, rootBattle),
    zone: normalizeZone(root.zone ?? root.location),
    position: normalizePosition(position),
    flags,
    directives: {
      avoidBattles: asBoolean(directives.avoidBattles, false),
    },
    echo: {
      connected: asBoolean(rootEcho.connected ?? rootEcho.ready, true),
      signalFound:
        asBoolean(rootEcho.signalFound ?? rootEcho.discovered, flags.vinesDiscovered) ||
        flags.vinesDiscovered,
      message: asString(
        rootEcho.message ?? rootEcho.lastMessage,
        flags.vinesDiscovered
          ? "I can follow the thread you found."
          : (activity.at(-1)?.detail ?? "Awaiting a human-found signal."),
      ),
      confidence: asNumber(rootEcho.confidence, flags.vinesDiscovered ? 1 : 0),
    },
    battle,
    activity,
    selectedLandmark: normalizeLandmark(root.selectedLandmark ?? root.landmark),
  };
};

export const getLandmark = (landmarkId: LandmarkId) => {
  for (const zone of Object.values(ZONE_CONTENT)) {
    const landmark = zone.landmarks.find((candidate) => candidate.id === landmarkId);
    if (landmark) return landmark;
  }
  return undefined;
};

export const resolveLandmarkAction = (
  landmark: LandmarkContent,
  snapshot: GameSnapshot,
): LandmarkActionResolution => {
  const position = { ...landmark.position };
  const samePosition =
    snapshot.zone === landmark.zone &&
    snapshot.position.x === position.x &&
    snapshot.position.y === position.y;
  const doorFollowUp =
    landmark.id === "ruins-sigil" && snapshot.flags.sigilRead && snapshot.flags.vinesDiscovered;

  if (snapshot.phase !== "journey" || !landmark.available(snapshot)) {
    return {
      state: "locked",
      position,
      label: landmark.actionLabel,
      hint: landmark.requirement ?? "This landmark is not available yet.",
    };
  }
  if (landmark.complete(snapshot) && !doorFollowUp) {
    return { state: "complete", position, label: landmark.actionLabel, hint: "Already complete." };
  }
  if (!samePosition) {
    return {
      state: "approach",
      position,
      label: doorFollowUp ? "Open ruin door with Interface" : landmark.actionLabel,
      hint: `Approach ${landmark.label} at ${position.x} · ${position.y}.`,
    };
  }
  return {
    state: "ready",
    position,
    label: doorFollowUp ? "Open ruin door with Interface" : landmark.actionLabel,
    hint: `You are at ${landmark.label}.`,
  };
};

const OBJECTIVES: Record<ObjectiveState["id"], ObjectiveState> = {
  complete: {
    id: "complete",
    title: "The forest remembers your path.",
    detail: "The cyan thread is carried safely into the core.",
  },
  battle: {
    id: "battle",
    title: "Break the guardian's pattern.",
    detail: "Choose a move. The guardian learns from repetition.",
  },
  beacon: {
    id: "beacon",
    title: "Light the camp beacon.",
    detail: "Start the canopy relay.",
  },
  resonance: {
    id: "resonance",
    title: "Calibrate Resonance at the relay.",
    detail: "Tune the copper station.",
  },
  travel: {
    id: "travel",
    title: "Travel to the ruins.",
    detail: "Take the calibrated signal into the broken observatory.",
  },
  rubble: {
    id: "rubble",
    title: "Clear the collapsed rubble.",
    detail: "Open a path to the old observatory door.",
  },
  power: {
    id: "power",
    title: "Restore the power cradle.",
    detail: "Give the ruin door one clean source of power.",
  },
  sigil: {
    id: "sigil",
    title: "Read the moss sigil.",
    detail: "Let the stone reveal its access lock.",
  },
  "human-discovery": {
    id: "human-discovery",
    title: "Find the cyan thread by hand.",
    detail: "Only a human lens can discover the hidden maintenance route.",
  },
  "return-sigil": {
    id: "return-sigil",
    title: "Return to the moss sigil and open the ruin door.",
    detail: "Bring the human-found thread back to the access lock.",
  },
  guardian: {
    id: "guardian",
    title: "Break the guardian's pattern.",
    detail: "The guardian stands between the signal and the Ancient Core.",
  },
  core: {
    id: "core",
    title: "Enter the ancient core.",
    detail: "Close the field note where the signal becomes a choice.",
  },
};

export const getObjectiveState = (snapshot: GameSnapshot): ObjectiveState => {
  if (snapshot.phase === "complete" || snapshot.flags.coreEntered)
    return { ...OBJECTIVES.complete };
  if (snapshot.phase === "battle") return { ...OBJECTIVES.battle };
  if (!snapshot.flags.beaconLit) return { ...OBJECTIVES.beacon };
  if (!snapshot.flags.resonanceCalibrated) return { ...OBJECTIVES.resonance };
  if (snapshot.zone === "camp") return { ...OBJECTIVES.travel };
  if (!snapshot.flags.rubbleCleared) return { ...OBJECTIVES.rubble };
  if (!snapshot.flags.powerRestored) return { ...OBJECTIVES.power };
  if (!snapshot.flags.sigilRead) return { ...OBJECTIVES.sigil };
  if (!snapshot.flags.vinesDiscovered) return { ...OBJECTIVES["human-discovery"] };
  if (snapshot.zone === "ruins") return { ...OBJECTIVES["return-sigil"] };
  if (!snapshot.flags.guardianDefeated) return { ...OBJECTIVES.guardian };
  return { ...OBJECTIVES.core };
};

export const getCurrentObjective = (snapshot: GameSnapshot) => getObjectiveState(snapshot).title;
