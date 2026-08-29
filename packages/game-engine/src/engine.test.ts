import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  createGameEngine,
  createJudgeDemoSnapshot,
  createNewJourneySnapshot,
  DIRECTIVES,
  decodeSnapshot,
  FAILURE_CODES,
  type GameSnapshot,
  InMemoryPersistenceAdapter,
  PHASES,
  SAVE_SCHEMA_VERSION,
} from "./index";

const human = { actor: "human" as const, source: "manual" as const };
const agent = { actor: "agent" as const, source: "webmcp" as const };

const moveToRelay = (engine: ReturnType<typeof createGameEngine>) => {
  const beacon = engine.dispatchSync({ type: "IGNITE", targetId: "echo-beacon" }, human);
  expect(beacon.ok).toBe(true);
  const result = engine.dispatchSync({ type: "MOVE", targetId: "relay" }, human);
  expect(result.ok).toBe(true);
};

const restoreRelay = (engine: ReturnType<typeof createGameEngine>) => {
  moveToRelay(engine);
  const result = engine.dispatchSync(
    { type: "USE_CAPABILITY", capability: CAPABILITIES.BREAK, targetId: "voltyn-relay" },
    agent,
  );
  expect(result.ok).toBe(true);
};

const reachDoor = (engine: ReturnType<typeof createGameEngine>) => {
  restoreRelay(engine);
  expect(engine.dispatchSync({ type: "MOVE", targetId: "ruins" }, agent).ok).toBe(true);
  expect(engine.dispatchSync({ type: "MOVE", targetId: "ruin-rubble" }, agent).ok).toBe(true);
  expect(engine.dispatchSync({ type: "BREAK", targetId: "ruin-rubble" }, agent).ok).toBe(true);
  expect(engine.dispatchSync({ type: "MOVE", targetId: "ruin-power" }, agent).ok).toBe(true);
  expect(engine.dispatchSync({ type: "IGNITE", targetId: "ruin-power" }, agent).ok).toBe(true);
  expect(engine.dispatchSync({ type: "MOVE", targetId: "ruin-door" }, agent).ok).toBe(true);
  expect(engine.dispatchSync({ type: "INTERFACE", targetId: "ruin-door" }, agent).ok).toBe(true);
};

describe("WildGent game engine", () => {
  it("starts fixtures at canonical positions and exposes human-only tile movement", () => {
    const journey = createGameEngine({ persist: false });
    expect(journey.getSnapshot().position).toEqual({ x: 1, y: 1 });

    const demo = createGameEngine({ mode: "judge-demo", persist: false });
    expect(demo.getSnapshot().position).toEqual({ x: 5, y: 2 });

    const stepped = journey.dispatchSync({ type: "STEP", direction: "east" }, human);
    expect(stepped.ok).toBe(true);
    expect(stepped.snapshot.position).toEqual({ x: 2, y: 1 });

    const agentStep = journey.dispatchSync({ type: "STEP", direction: "south" }, agent);
    expect(agentStep.ok).toBe(false);
    expect(agentStep.code).toBe(FAILURE_CODES.INVALID_CONTEXT);
    expect(agentStep.snapshot.position).toEqual({ x: 2, y: 1 });

    const origin = journey.dispatchSync(
      { type: "MOVE_TO_POSITION", position: { x: 0, y: 0 } },
      human,
    );
    expect(origin.ok).toBe(true);
    expect(origin.snapshot.position).toEqual({ x: 0, y: 0 });

    const northFromOrigin = journey.dispatchSync({ type: "STEP", direction: "north" }, human);
    expect(northFromOrigin.ok).toBe(false);
    expect(northFromOrigin.code).toBe(FAILURE_CODES.INVALID_POSITION);
    expect(northFromOrigin.snapshot.position).toEqual({ x: 0, y: 0 });

    const westFromOrigin = journey.dispatchSync({ type: "STEP", direction: "west" }, human);
    expect(westFromOrigin.ok).toBe(false);
    expect(westFromOrigin.code).toBe(FAILURE_CODES.INVALID_POSITION);
    expect(westFromOrigin.snapshot.position).toEqual({ x: 0, y: 0 });

    const maxEdge = journey.dispatchSync(
      { type: "MOVE_TO_POSITION", position: { x: 9, y: 6 } },
      human,
    );
    expect(maxEdge.ok).toBe(true);
    expect(maxEdge.snapshot.position).toEqual({ x: 9, y: 6 });

    const agentDirect = journey.dispatchSync(
      { type: "MOVE_TO_POSITION", position: { x: 3, y: 3 } },
      agent,
    );
    expect(agentDirect.ok).toBe(false);
    expect(agentDirect.code).toBe(FAILURE_CODES.INVALID_CONTEXT);
    expect(agentDirect.snapshot.position).toEqual({ x: 9, y: 6 });

    for (const position of [
      { x: -1, y: 0 },
      { x: 10, y: 6 },
      { x: 9, y: 7 },
    ]) {
      const invalid = journey.dispatchSync({ type: "MOVE_TO_POSITION", position }, human);
      expect(invalid.ok).toBe(false);
      expect(invalid.code).toBe(FAILURE_CODES.INVALID_POSITION);
      expect(invalid.snapshot.position).toEqual({ x: 9, y: 6 });
    }

    const fractional = journey.dispatchSync(
      { type: "MOVE_TO_POSITION", position: { x: 1.5, y: 6 } },
      human,
    );
    expect(fractional.ok).toBe(false);
    expect(fractional.code).toBe(FAILURE_CODES.INVALID_POSITION);
    expect(fractional.snapshot.position).toEqual({ x: 9, y: 6 });
    const sameTile = journey.dispatchSync(
      { type: "MOVE_TO_POSITION", position: { x: 9, y: 6 } },
      human,
    );
    expect(sameTile.ok).toBe(true);
    expect(sameTile.snapshot.position).toEqual({ x: 9, y: 6 });
    const edgeStep = journey.dispatchSync({ type: "STEP", direction: "east" }, human);
    expect(edgeStep.ok).toBe(false);
    expect(edgeStep.code).toBe(FAILURE_CODES.INVALID_POSITION);
    expect(edgeStep.snapshot.position).toEqual({ x: 9, y: 6 });
    const bottomStep = journey.dispatchSync({ type: "STEP", direction: "south" }, human);
    expect(bottomStep.ok).toBe(false);
    expect(bottomStep.code).toBe(FAILURE_CODES.INVALID_POSITION);
    expect(bottomStep.snapshot.position).toEqual({ x: 9, y: 6 });
    expect(journey.getSnapshot().schemaVersion).toBe(SAVE_SCHEMA_VERSION);
  });

  it("accepts zero-based persisted grid edges and rejects positions outside them", () => {
    const origin = JSON.parse(JSON.stringify(createNewJourneySnapshot())) as Record<
      string,
      unknown
    >;
    origin.position = { x: 0, y: 0 };
    expect(decodeSnapshot(origin)?.position).toEqual({ x: 0, y: 0 });

    const maxEdge = JSON.parse(JSON.stringify(createNewJourneySnapshot())) as Record<
      string,
      unknown
    >;
    maxEdge.position = { x: 9, y: 6 };
    expect(decodeSnapshot(maxEdge)?.position).toEqual({ x: 9, y: 6 });

    for (const position of [
      { x: -1, y: 0 },
      { x: 10, y: 6 },
      { x: 9, y: 7 },
    ]) {
      const invalid = JSON.parse(JSON.stringify(createNewJourneySnapshot())) as Record<
        string,
        unknown
      >;
      invalid.position = position;
      expect(decodeSnapshot(invalid)).toBeNull();
    }
  });

  it("moves to visible landmarks and assigns canonical route positions", () => {
    const engine = createGameEngine({ persist: false });
    expect(engine.dispatchSync({ type: "IGNITE", targetId: "echo-beacon" }, human).ok).toBe(true);

    const relay = engine.dispatchSync({ type: "MOVE", targetId: "voltyn-relay" }, agent);
    expect(relay.ok).toBe(true);
    expect(relay.snapshot.position).toEqual({ x: 5, y: 2 });

    const beacon = engine.dispatchSync({ type: "MOVE", targetId: "echo-beacon" }, agent);
    expect(beacon.ok).toBe(true);
    expect(beacon.snapshot.position).toEqual({ x: 1, y: 1 });

    const returnToRelay = engine.dispatchSync({ type: "MOVE", targetId: "voltyn-relay" }, human);
    expect(returnToRelay.ok).toBe(true);
    expect(returnToRelay.snapshot.position).toEqual({ x: 5, y: 2 });

    expect(engine.dispatchSync({ type: "BREAK", targetId: "voltyn-relay" }, human).ok).toBe(true);
    const ruins = engine.dispatchSync({ type: "MOVE", targetId: "ruins" }, agent);
    expect(ruins.ok).toBe(true);
    expect(ruins.snapshot.position).toEqual({ x: 1, y: 1 });
  });

  it("gates relay routes and relay target visibility until the beacon is lit", () => {
    const humanEngine = createGameEngine({ persist: false });
    const humanStart = humanEngine.getSnapshot();
    expect(humanStart.beaconLit).toBe(false);
    expect(humanStart.visibleTargets).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "voltyn-relay" })]),
    );

    for (const targetId of ["relay", "voltyn-relay"]) {
      const refused = humanEngine.dispatchSync({ type: "MOVE", targetId }, human);
      expect(refused.ok).toBe(false);
      expect(refused.code).toBe(FAILURE_CODES.INVALID_PHASE);
      expect(refused.snapshot.position).toEqual(humanStart.position);
    }

    expect(humanEngine.dispatchSync({ type: "IGNITE", targetId: "echo-beacon" }, human).ok).toBe(
      true,
    );
    expect(humanEngine.getSnapshot().visibleTargets).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "voltyn-relay" })]),
    );
    const humanMoved = humanEngine.dispatchSync({ type: "MOVE", targetId: "voltyn-relay" }, human);
    expect(humanMoved.ok).toBe(true);
    expect(humanMoved.snapshot.position).toEqual({ x: 5, y: 2 });

    const agentEngine = createGameEngine({ persist: false });
    const agentStart = agentEngine.getSnapshot();
    for (const targetId of ["relay", "voltyn-relay"]) {
      const refused = agentEngine.dispatchSync({ type: "MOVE", targetId }, agent);
      expect(refused.ok).toBe(false);
      expect(refused.code).toBe(FAILURE_CODES.TARGET_NOT_FOUND);
      expect(refused.snapshot.position).toEqual(agentStart.position);
    }

    expect(agentEngine.dispatchSync({ type: "IGNITE", targetId: "echo-beacon" }, human).ok).toBe(
      true,
    );
    const agentMoved = agentEngine.dispatchSync({ type: "MOVE", targetId: "voltyn-relay" }, agent);
    expect(agentMoved.ok).toBe(true);
    expect(agentMoved.snapshot.position).toEqual({ x: 5, y: 2 });
  });

  it("requires exact target proximity for capabilities and reports the refusal context", () => {
    const engine = createGameEngine({ persist: false });
    expect(engine.dispatchSync({ type: "STEP", direction: "east" }, human).ok).toBe(true);

    const refused = engine.dispatchSync({ type: "IGNITE", targetId: "echo-beacon" }, human);
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe(FAILURE_CODES.OUT_OF_RANGE);
    if (refused.ok) throw new Error("Expected beacon ignition to be refused.");
    expect(refused.error.details).toMatchObject({
      targetId: "echo-beacon",
      currentPosition: { x: 2, y: 1 },
      requiredPosition: { x: 1, y: 1 },
    });
    expect(refused.snapshot.position).toEqual({ x: 2, y: 1 });
    expect(refused.snapshot.beaconLit).toBe(false);

    expect(
      engine.dispatchSync({ type: "MOVE_TO_POSITION", position: { x: 1, y: 1 } }, human).ok,
    ).toBe(true);
    expect(engine.dispatchSync({ type: "IGNITE", targetId: "echo-beacon" }, human).ok).toBe(true);
  });

  it("keeps hidden discovery human-only and requires the human to approach it", () => {
    const engine = createGameEngine({ persist: false });
    reachDoor(engine);

    const before = engine.getSnapshot();
    const agentMove = engine.dispatchSync({ type: "MOVE", targetId: "maintenance-path" }, agent);
    expect(agentMove.ok).toBe(false);
    expect(agentMove.code).toBe(FAILURE_CODES.HUMAN_DISCOVERY_REQUIRED);
    expect(agentMove.snapshot.position).toEqual(before.position);

    const refused = engine.dispatchSync({ type: "DISCOVER", targetId: "maintenance-path" }, human);
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe(FAILURE_CODES.OUT_OF_RANGE);
    if (refused.ok) throw new Error("Expected discovery to be refused.");
    expect(refused.error.details).toMatchObject({
      targetId: "maintenance-path",
      currentPosition: before.position,
      requiredPosition: { x: 8, y: 2 },
    });
    expect(refused.snapshot.position).toEqual(before.position);

    expect(
      engine.dispatchSync({ type: "MOVE_TO_POSITION", position: { x: 8, y: 2 } }, human).ok,
    ).toBe(true);
    expect(
      engine.dispatchSync({ type: "MOVE_TO_POSITION", position: { x: 8, y: 2 } }, human).ok,
    ).toBe(true);
    expect(engine.dispatchSync({ type: "DISCOVER", targetId: "maintenance-path" }, human).ok).toBe(
      true,
    );
    expect(engine.getSnapshot().puzzle.maintenancePathDiscovered).toBe(true);
  });

  it("locks grid movement during battle and requires an approach before claiming the core", () => {
    const engine = createGameEngine({ persist: false });
    reachDoor(engine);
    engine.dispatchSync({ type: "MOVE_TO_POSITION", position: { x: 8, y: 2 } }, human);
    expect(engine.dispatchSync({ type: "DISCOVER", targetId: "maintenance-path" }, human).ok).toBe(
      true,
    );
    expect(engine.dispatchSync({ type: "MOVE", targetId: "ruin-door" }, agent).ok).toBe(true);
    expect(engine.dispatchSync({ type: "INTERFACE", targetId: "ruin-door" }, agent).ok).toBe(true);
    expect(engine.getSnapshot().position).toEqual({ x: 7, y: 4 });

    const battleStep = engine.dispatchSync({ type: "STEP", direction: "east" }, human);
    expect(battleStep.ok).toBe(false);
    expect(battleStep.code).toBe(FAILURE_CODES.INVALID_PHASE);
    const battleDirect = engine.dispatchSync(
      { type: "MOVE_TO_POSITION", position: { x: 4, y: 4 } },
      human,
    );
    expect(battleDirect.ok).toBe(false);
    expect(battleDirect.code).toBe(FAILURE_CODES.INVALID_PHASE);

    expect(engine.dispatchSync({ type: "START_BATTLE" }, agent).ok).toBe(true);
    for (let index = 0; index < 6; index += 1) {
      if (engine.getSnapshot().battle?.status === "won") break;
      expect(engine.dispatchSync({ type: "STRIKE" }, agent).ok).toBe(true);
    }
    expect(engine.getSnapshot().phase).toBe(PHASES.CORE);
    expect(engine.getSnapshot().position).toEqual({ x: 7, y: 4 });

    const refusedClaim = engine.dispatchSync({ type: "CLAIM_CORE" }, agent);
    expect(refusedClaim.ok).toBe(false);
    expect(refusedClaim.code).toBe(FAILURE_CODES.OUT_OF_RANGE);
    if (refusedClaim.ok) throw new Error("Expected core claim to be refused.");
    expect(refusedClaim.error.details).toMatchObject({
      targetId: "ancient-core",
      currentPosition: { x: 7, y: 4 },
      requiredPosition: { x: 4, y: 4 },
    });

    expect(engine.dispatchSync({ type: "MOVE", targetId: "ancient-core" }, agent).ok).toBe(true);
    expect(engine.getSnapshot().position).toEqual({ x: 4, y: 4 });
    expect(engine.dispatchSync({ type: "CLAIM_CORE" }, agent).ok).toBe(true);
    expect(engine.getSnapshot().phase).toBe(PHASES.COMPLETE);
    expect(engine.dispatchSync({ type: "STEP", direction: "north" }, human).code).toBe(
      FAILURE_CODES.INVALID_PHASE,
    );
  });

  it("returns authoritative position from world queries and subscriptions", () => {
    const engine = createGameEngine({ persist: false });
    const world = engine.query("world");
    expect(world).toMatchObject({ position: { x: 1, y: 1 } });

    const updates: Array<{ x: number; y: number }> = [];
    const unsubscribe = engine.subscribe((snapshot) => updates.push({ ...snapshot.position }));
    expect(engine.dispatchSync({ type: "STEP", direction: "south" }, human).ok).toBe(true);
    unsubscribe();

    expect(updates).toEqual([{ x: 1, y: 2 }]);
    expect(engine.query("world")).toMatchObject({ position: { x: 1, y: 2 } });
    expect(engine.query("look_around")).toMatchObject({ position: { x: 1, y: 2 } });
  });

  it("records beacon ignition in the authoritative snapshot", () => {
    const engine = createGameEngine({ persist: false });
    expect(engine.getSnapshot().beaconLit).toBe(false);
    expect(engine.dispatchSync({ type: "IGNITE", targetId: "echo-beacon" }, human).ok).toBe(true);
    expect(engine.getSnapshot().beaconLit).toBe(true);
    expect(engine.query("targets")).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "echo-beacon" })]),
    );
  });

  it("runs relay resonance and unlocks interface through the shared dispatcher", () => {
    const engine = createGameEngine({ persist: false });
    expect(engine.getSnapshot().capabilities).toEqual(["ignite", "break"]);

    restoreRelay(engine);
    const snapshot = engine.getSnapshot();

    expect(snapshot.relay.restored).toBe(true);
    expect(snapshot.resonance.occurred).toBe(true);
    expect(snapshot.resonance.wildGentId).toBe("voltyn");
    expect(snapshot.capabilities).toContain("interface");
    expect(snapshot.partyIds).toContain("voltyn");
    expect(snapshot.activity.at(-1)?.actor).toBe("agent");
  });

  it("enforces the ruin puzzle order", () => {
    const engine = createGameEngine({ persist: false });
    restoreRelay(engine);
    expect(engine.dispatchSync({ type: "MOVE", targetId: "ruins" }, agent).ok).toBe(true);

    const powerTooSoon = engine.dispatchSync({ type: "IGNITE", targetId: "ruin-power" }, agent);
    expect(powerTooSoon.ok).toBe(false);
    expect(powerTooSoon.code).toBe(FAILURE_CODES.PUZZLE_ORDER);

    expect(engine.dispatchSync({ type: "MOVE", targetId: "ruin-rubble" }, agent).ok).toBe(true);
    expect(engine.dispatchSync({ type: "BREAK", targetId: "ruin-rubble" }, agent).ok).toBe(true);
    expect(engine.dispatchSync({ type: "MOVE", targetId: "ruin-power" }, agent).ok).toBe(true);
    expect(engine.dispatchSync({ type: "IGNITE", targetId: "ruin-power" }, agent).ok).toBe(true);
    expect(engine.dispatchSync({ type: "MOVE", targetId: "ruin-door" }, agent).ok).toBe(true);
    const door = engine.dispatchSync({ type: "INTERFACE", targetId: "ruin-door" }, agent);
    expect(door.ok).toBe(true);
    expect(engine.getSnapshot().puzzle.order).toEqual(["rubble", "power"]);
  });

  it("keeps hidden maintenance discovery human-only and then shares it", () => {
    const engine = createGameEngine({ persist: false });
    reachDoor(engine);

    const before = engine.query("world");
    expect(typeof before).toBe("object");
    if (typeof before === "object" && before !== null && "visibleTargets" in before) {
      expect(before.visibleTargets.some((target) => target.id === "maintenance-path")).toBe(false);
    }

    const agentDiscovery = engine.dispatchSync(
      { type: "DISCOVER", targetId: "maintenance-path" },
      agent,
    );
    expect(agentDiscovery.ok).toBe(false);
    expect(agentDiscovery.code).toBe(FAILURE_CODES.HUMAN_DISCOVERY_REQUIRED);

    const agentInteraction = engine.dispatchSync(
      { type: "INTERACT", targetId: "maintenance-path" },
      agent,
    );
    expect(agentInteraction.ok).toBe(false);
    expect(agentInteraction.code).toBe(FAILURE_CODES.HUMAN_DISCOVERY_REQUIRED);

    expect(
      engine.dispatchSync({ type: "MOVE_TO_POSITION", position: { x: 8, y: 2 } }, human).ok,
    ).toBe(true);
    expect(engine.dispatchSync({ type: "DISCOVER", targetId: "maintenance-path" }, human).ok).toBe(
      true,
    );
    expect(engine.getSnapshot().sharedDiscoveries).toContain("maintenance-path");
    const after = engine.query("world");
    if (typeof after === "object" && after !== null && "visibleTargets" in after) {
      expect(after.visibleTargets.some((target) => target.id === "maintenance-path")).toBe(true);
    }
  });

  it("honors the human-owned Avoid battles directive", () => {
    const engine = createGameEngine({ persist: false });
    reachDoor(engine);
    expect(
      engine.dispatchSync({ type: "SET_DIRECTIVE", directive: "Avoid battles" }, human).ok,
    ).toBe(true);

    expect(engine.getSnapshot().directives.active).toEqual([DIRECTIVES.AVOID_BATTLES]);
    const agentChange = engine.dispatchSync(
      { type: "SET_DIRECTIVE", directive: DIRECTIVES.AVOID_BATTLES, active: false },
      agent,
    );
    expect(agentChange.ok).toBe(false);
    expect(agentChange.code).toBe(FAILURE_CODES.DIRECTIVE_BLOCKED);

    const blockedBattle = engine.dispatchSync({ type: "START_BATTLE" }, agent);
    expect(blockedBattle.ok).toBe(false);
    expect(blockedBattle.code).toBe(FAILURE_CODES.DIRECTIVE_BLOCKED);
  });

  it("uses deterministic battle numbers and reaches the Ancient Core", () => {
    const engine = createGameEngine({ persist: false });
    reachDoor(engine);
    engine.dispatchSync({ type: "MOVE_TO_POSITION", position: { x: 8, y: 2 } }, human);
    expect(engine.dispatchSync({ type: "DISCOVER", targetId: "maintenance-path" }, human).ok).toBe(
      true,
    );
    expect(engine.dispatchSync({ type: "MOVE", targetId: "ruin-door" }, agent).ok).toBe(true);
    expect(engine.dispatchSync({ type: "INTERFACE", targetId: "ruin-door" }, agent).ok).toBe(true);
    expect(engine.getSnapshot().battle?.status).toBe("encounter");
    expect(engine.dispatchSync({ type: "START_BATTLE" }, agent).ok).toBe(true);

    const first = engine.dispatchSync({ type: "BATTLE_ACTION", action: "strike" }, agent);
    expect(first.ok).toBe(true);
    expect(engine.getSnapshot().battle?.guardianHp).toBe(15);
    expect(engine.getSnapshot().battle?.playerHp).toBe(16);

    for (let index = 0; index < 6; index += 1) {
      const result = engine.dispatchSync({ type: "SIGNATURE" }, agent);
      if (!result.ok && result.code === FAILURE_CODES.SIGNATURE_ALREADY_USED) {
        expect(result.code).toBe(FAILURE_CODES.SIGNATURE_ALREADY_USED);
        break;
      }
      if (engine.getSnapshot().battle?.status === "won") break;
      engine.dispatchSync({ type: "STRIKE" }, agent);
    }

    expect(engine.getSnapshot().battle?.guardianHp).toBeGreaterThanOrEqual(0);
    // A fixed action sequence cannot introduce random damage or a random turn.
    const replay = createGameEngine({ persist: false });
    reachDoor(replay);
    replay.dispatchSync({ type: "MOVE_TO_POSITION", position: { x: 8, y: 2 } }, human);
    replay.dispatchSync({ type: "DISCOVER", targetId: "maintenance-path" }, human);
    replay.dispatchSync({ type: "MOVE", targetId: "ruin-door" }, agent);
    replay.dispatchSync({ type: "INTERFACE", targetId: "ruin-door" }, agent);
    replay.dispatchSync({ type: "START_BATTLE" }, agent);
    replay.dispatchSync({ type: "STRIKE" }, agent);
    expect(replay.getSnapshot().battle?.guardianHp).toBe(15);
  });

  it("lets one WebMCP battle_action call start an encounter", () => {
    const engine = createGameEngine({ persist: false });
    reachDoor(engine);
    engine.dispatchSync({ type: "MOVE_TO_POSITION", position: { x: 8, y: 2 } }, human);
    expect(engine.dispatchSync({ type: "DISCOVER", targetId: "maintenance-path" }, human).ok).toBe(
      true,
    );
    expect(engine.dispatchSync({ type: "MOVE", targetId: "ruin-door" }, agent).ok).toBe(true);
    expect(engine.dispatchSync({ type: "INTERFACE", targetId: "ruin-door" }, agent).ok).toBe(true);

    const result = engine.dispatchSync({ type: "BATTLE_ACTION", action: "environment" }, agent);
    expect(result.ok).toBe(true);
    expect(engine.getSnapshot().battle?.status).toBe("active");
    expect(engine.getSnapshot().battle?.guardianHp).toBe(14);
  });

  it("persists valid saves, rejects corrupt saves, and restores checkpoints", () => {
    const storage = new InMemoryPersistenceAdapter();
    const first = createGameEngine({ storage });
    restoreRelay(first);
    const persisted = createGameEngine({ storage });
    expect(persisted.getSnapshot().resonance.occurred).toBe(true);
    expect(persisted.getSnapshot().position).toEqual({ x: 5, y: 2 });
    expect(persisted.resetSync("checkpoint").snapshot.resonance.occurred).toBe(true);
    expect(persisted.getSnapshot().position).toEqual({ x: 5, y: 2 });

    storage.save("{not valid json");
    const recovered = createGameEngine({ storage });
    expect(recovered.getSnapshot().schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(recovered.getSnapshot().phase).toBe(PHASES.CAMP);

    const effectResult = Effect.runSync(recovered.reset("judge-demo"));
    expect(effectResult.snapshot.mode).toBe("judge-demo");
    expect(effectResult.snapshot.resonance.occurred).toBe(false);
    expect(effectResult.snapshot.position).toEqual({ x: 5, y: 2 });

    const malformedCheckpoint = {
      ...recovered.getSnapshot(),
      checkpoint: { available: true, label: "resonance", snapshot: { malformed: true } },
    };
    storage.save(JSON.stringify(malformedCheckpoint));
    expect(() => createGameEngine({ storage })).not.toThrow();

    const clean = createGameEngine({ storage });
    clean.resetSync("clean");
    expect(createGameEngine({ storage }).getSnapshot().mode).toBe("new-journey");
  });

  it("migrates v1 positions for roots and nested checkpoints while rejecting invalid v2 positions", () => {
    const legacyJourney = JSON.parse(JSON.stringify(createNewJourneySnapshot())) as Record<
      string,
      unknown
    >;
    delete legacyJourney.position;
    legacyJourney.schemaVersion = 1;
    const legacyCheckpoint = JSON.parse(JSON.stringify(legacyJourney)) as Record<string, unknown>;
    legacyJourney.checkpoint = {
      available: true,
      label: "start",
      snapshot: legacyCheckpoint,
    };

    const decodedJourney = decodeSnapshot(legacyJourney);
    expect(decodedJourney?.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(decodedJourney?.position).toEqual({ x: 1, y: 1 });
    expect(decodedJourney?.checkpoint.snapshot?.position).toEqual({ x: 1, y: 1 });

    const legacyRelay = JSON.parse(JSON.stringify(createJudgeDemoSnapshot())) as Record<
      string,
      unknown
    >;
    delete legacyRelay.position;
    legacyRelay.schemaVersion = 1;
    expect(decodeSnapshot(legacyRelay)?.position).toEqual({ x: 5, y: 2 });

    const legacyBattle = JSON.parse(JSON.stringify(createNewJourneySnapshot())) as Record<
      string,
      unknown
    >;
    legacyBattle.schemaVersion = 1;
    legacyBattle.phase = "battle";
    legacyBattle.scene = "core";
    legacyBattle.currentScene = "core";
    legacyBattle.location = "core";
    legacyBattle.battle = { status: "active" };
    expect(decodeSnapshot(legacyBattle)?.position).toEqual({ x: 7, y: 4 });

    const legacyWon = JSON.parse(JSON.stringify(legacyBattle)) as Record<string, unknown>;
    legacyWon.phase = "core";
    legacyWon.battle = { status: "won" };
    expect(decodeSnapshot(legacyWon)?.position).toEqual({ x: 4, y: 4 });

    const malformed = JSON.parse(JSON.stringify(createNewJourneySnapshot())) as Record<
      string,
      unknown
    >;
    malformed.position = { x: 10, y: 1 };
    const storage = new InMemoryPersistenceAdapter();
    storage.save(JSON.stringify(malformed));
    const recovered = createGameEngine({ storage });
    expect(recovered.getSnapshot().mode).toBe("new-journey");
    expect(recovered.getSnapshot().position).toEqual({ x: 1, y: 1 });
  });

  it("keeps manual and agent actions on the same transition path", () => {
    const manual = createGameEngine({ persist: false });
    const agentEngine = createGameEngine({ persist: false });
    moveToRelay(manual);
    expect(agentEngine.dispatchSync({ type: "IGNITE", targetId: "echo-beacon" }, human).ok).toBe(
      true,
    );
    agentEngine.dispatchSync({ type: "MOVE", targetId: "relay" }, agent);

    const manualResult = manual.dispatchSync({ type: "BREAK", targetId: "voltyn-relay" }, human);
    const agentResult = agentEngine.dispatchSync(
      { type: "BREAK", targetId: "voltyn-relay" },
      agent,
    );
    expect(manualResult.ok).toBe(true);
    expect(agentResult.ok).toBe(true);
    const comparable = (snapshot: GameSnapshot) => ({
      phase: snapshot.phase,
      location: snapshot.location,
      relay: snapshot.relay,
      resonance: snapshot.resonance,
      capabilities: snapshot.capabilities,
      partyIds: snapshot.partyIds,
    });
    expect(comparable(manual.getSnapshot())).toEqual(comparable(agentEngine.getSnapshot()));
  });

  it("notifies subscribers with accepted and refused activity", () => {
    const engine = createGameEngine({ persist: false });
    expect(engine.dispatchSync({ type: "IGNITE", targetId: "echo-beacon" }, human).ok).toBe(true);
    const events: string[] = [];
    const unsubscribe = engine.subscribe((_snapshot, event) => {
      if (event !== undefined) events.push(`${event.kind}:${event.code}`);
    });
    engine.dispatchSync({ type: "MOVE", targetId: "unknown" }, agent);
    engine.dispatchSync({ type: "MOVE", targetId: "relay" }, human);
    unsubscribe();
    expect(events).toEqual(["refused:TARGET_NOT_FOUND", "accepted:OK"]);
  });
});
