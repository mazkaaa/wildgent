import * as EnginePackage from "@wildgent/game-engine";
import * as Engine from "effect/Effect";

import type { CardinalDirection, GameAction, GameSnapshot, LandmarkId } from "./app-model";
import { normalizeSnapshot } from "./app-model";

type UnknownRecord = Record<string, unknown>;

export type RawEngine = {
  dispatch: (action: unknown, context?: unknown) => unknown;
  query: (query: unknown) => unknown;
  getSnapshot: () => unknown;
  subscribe: (listener: (snapshot: unknown) => void) => unknown;
  reset: (options?: unknown) => unknown;
};

export type EngineSnapshotListener = (snapshot: GameSnapshot) => void;

const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === "object";

const asRecord = (value: unknown): UnknownRecord => (isRecord(value) ? value : {});

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  isRecord(value) && typeof value.then === "function";

const resolveValue = async (value: unknown): Promise<unknown> => {
  if (isPromiseLike(value)) return value;
  if (Engine.isEffect(value))
    return (Engine.runPromise as (effect: unknown) => Promise<unknown>)(value);
  return value;
};

const asFunction = (value: unknown): ((...args: unknown[]) => unknown) | undefined =>
  typeof value === "function" ? (value as (...args: unknown[]) => unknown) : undefined;

const bindEngineMethods = (candidate: UnknownRecord): RawEngine | undefined => {
  const dispatch = asFunction(candidate.dispatch);
  const query = asFunction(candidate.query);
  const getSnapshot = asFunction(candidate.getSnapshot);
  const subscribe = asFunction(candidate.subscribe);
  const reset = asFunction(candidate.reset);
  if (!dispatch || !query || !getSnapshot || !subscribe || !reset) return undefined;
  return {
    dispatch: dispatch.bind(candidate),
    query: query.bind(candidate),
    getSnapshot: getSnapshot.bind(candidate),
    subscribe: subscribe.bind(candidate),
    reset: reset.bind(candidate),
  };
};

/**
 * Keep the package seam small while the engine package is iterating. The app only depends on the
 * five public operations and does not reach into rules, schemas, or persistence details.
 */
export const createEngineAdapter = (): RawEngine => {
  const moduleRecord = EnginePackage as unknown as UnknownRecord;
  const candidates: unknown[] = [
    moduleRecord.gameEngine,
    moduleRecord.engine,
    moduleRecord.default,
  ];

  for (const candidate of candidates) {
    if (isRecord(candidate)) {
      const bound = bindEngineMethods(candidate);
      if (bound) return bound;
    }
  }

  for (const factoryName of ["createGameEngine", "createEngine", "makeGameEngine"]) {
    const factory = asFunction(moduleRecord[factoryName]);
    if (!factory) continue;
    const candidate = factory();
    if (isRecord(candidate)) {
      const bound = bindEngineMethods(candidate);
      if (bound) return bound;
    }
  }

  const moduleEngine = bindEngineMethods(moduleRecord);
  if (moduleEngine) return moduleEngine;

  throw new Error(
    "@wildgent/game-engine did not expose dispatch/query/getSnapshot/subscribe/reset or an engine factory.",
  );
};

export class EngineAdapter {
  readonly raw: RawEngine;

  constructor(raw: RawEngine = createEngineAdapter()) {
    this.raw = raw;
  }

  getSnapshot(): GameSnapshot {
    return normalizeSnapshot(this.raw.getSnapshot());
  }

  async dispatch(
    action: GameAction,
    context: unknown = { actor: "human", source: "manual" },
  ): Promise<unknown> {
    const commands = this.toCommands(action);
    let result: unknown;
    for (const command of commands) {
      result = await resolveValue(this.raw.dispatch(command, context));
      if (isRecord(result) && result.ok === false) return result;
    }
    return result;
  }

  async dispatchCommand(
    command: unknown,
    context: unknown = { actor: "agent", source: "webmcp" },
  ): Promise<unknown> {
    return resolveValue(this.raw.dispatch(command, context));
  }

  async query(query: unknown): Promise<unknown> {
    return resolveValue(this.raw.query(query));
  }

  subscribe(listener: EngineSnapshotListener): () => void {
    const result = this.raw.subscribe((snapshot) => listener(normalizeSnapshot(snapshot)));
    return typeof result === "function" ? (result as () => void) : () => undefined;
  }

  async reset(options?: unknown): Promise<unknown> {
    const mode = isRecord(options) && typeof options.mode === "string" ? options.mode : options;
    const normalizedMode =
      mode === "demo" || mode === "judge-demo"
        ? "judge-demo"
        : mode === "checkpoint"
          ? "checkpoint"
          : mode === "clean"
            ? "clean"
            : "new-journey";
    return resolveValue(this.raw.reset(normalizedMode));
  }

  private toCommands(action: GameAction): unknown[] {
    switch (action.type) {
      case "START_JOURNEY":
        return [{ type: "START_JOURNEY" }];
      case "START_DEMO":
        return [{ type: "JUDGE_DEMO" }];
      case "MOVE_STEP":
        return [{ type: "STEP", direction: action.direction }];
      case "MOVE_TO": {
        return [{ type: "MOVE_TO_POSITION", position: action.position }];
      }
      case "TRAVEL_TO":
        return [{ type: "MOVE", targetId: action.zone }];
      case "INTERACT":
        return this.interactionCommands(action.landmark);
      case "DISCOVER_SIGNAL":
        return [{ type: "DISCOVER", targetId: "maintenance-path" }];
      case "SET_DIRECTIVE":
        return [
          {
            type: "SET_DIRECTIVE",
            directive: action.directive,
            active: action.active,
          },
        ];
      case "ATTACK": {
        const battle = asRecord(asRecord(this.raw.getSnapshot()).battle);
        const commands: unknown[] = [];
        if (battle.status === "encounter") commands.push({ type: "START_BATTLE" });
        const actionName =
          action.move === "resonance" ? "signature" : action.move === "guard" ? "defend" : "strike";
        commands.push({ type: "BATTLE_ACTION", action: actionName });
        return commands;
      }
      case "ENTER_CORE": {
        const root = asRecord(this.raw.getSnapshot());
        const battle = asRecord(root.battle);
        return [
          battle.status === "won" ? { type: "CLAIM_CORE" } : { type: "ENTER", targetId: "core" },
        ];
      }
      case "RESET":
        return [];
      default:
        return [];
    }
  }

  private interactionCommands(landmark: LandmarkId): unknown[] {
    switch (landmark) {
      case "camp-beacon":
        return [{ type: "IGNITE", targetId: "echo-beacon" }];
      case "relay-station":
        // Camp and relay share one diorama zone, but the engine keeps relay as a distinct
        // semantic location for its capability rules. Approach is still represented by the
        // preceding MOVE_TO_POSITION; this route transition only enters the relay location.
        return [
          { type: "MOVE", targetId: "relay" },
          { type: "BREAK", targetId: "voltyn-relay" },
        ];
      case "ruins-rubble":
        return [{ type: "BREAK", targetId: "ruin-rubble" }];
      case "ruins-power":
        return [{ type: "IGNITE", targetId: "ruin-power" }];
      case "ruins-sigil":
        return [{ type: "INTERFACE", targetId: "ruin-door" }];
      case "ruins-vines":
        return [{ type: "INTERFACE", targetId: "ruin-door" }];
      case "ancient-core":
        return [{ type: "CLAIM_CORE" }];
      default:
        return [];
    }
  }
}

export type PresentationSync = (snapshot: GameSnapshot) => void | Promise<void>;

export type DispatchSuccess = { ok: true; snapshot: GameSnapshot; value: unknown };

export type DispatchFailure = {
  ok: false;
  code: "BUSY" | "CANCELLED" | "ENGINE_ERROR";
  error?: unknown;
  snapshot: GameSnapshot;
};

export type CoordinatorResult = DispatchSuccess | DispatchFailure;

/**
 * Serializes mutations at the app boundary. The ordering is deliberate:
 * engine transition -> Three presentation sync -> unlock. Queries never enter the lock.
 */
export class ActionCoordinator {
  private busy = false;
  private movementDraining = false;
  private readonly queuedSteps: Array<{
    direction: CardinalDirection;
    context: unknown;
    resolve: (result: CoordinatorResult) => void;
  }> = [];
  private readonly subscribers = new Set<(busy: boolean) => void>();
  private presentationSync: PresentationSync = () => undefined;

  constructor(private readonly engine: EngineAdapter) {}

  get isBusy() {
    return this.busy;
  }

  getSnapshot() {
    return this.engine.getSnapshot();
  }

  subscribe(listener: EngineSnapshotListener) {
    return this.engine.subscribe(listener);
  }

  subscribeBusy(listener: (busy: boolean) => void) {
    this.subscribers.add(listener);
    listener(this.busy);
    return () => this.subscribers.delete(listener);
  }

  setPresentationSync(sync: PresentationSync) {
    this.presentationSync = sync;
  }

  async query(query: unknown) {
    return this.engine.query(query);
  }

  enqueueHumanStep(
    direction: CardinalDirection,
    context: unknown = { actor: "human", source: "manual" },
  ): Promise<CoordinatorResult> {
    if (this.getSnapshot().phase !== "journey") {
      return Promise.resolve(this.cancelledResult());
    }
    const result = new Promise<CoordinatorResult>((resolve) => {
      this.queuedSteps.push({ direction, context, resolve });
    });
    if (!this.busy) {
      this.setBusy(true);
      void this.drainHumanSteps();
    }
    return result;
  }

  cancelQueuedSteps() {
    const snapshot = this.getSnapshot();
    const queued = this.queuedSteps.splice(0);
    for (const item of queued) item.resolve(this.cancelledResult(snapshot));
  }

  async dispatch(action: GameAction, context?: unknown): Promise<CoordinatorResult> {
    if (this.busy) {
      return { ok: false, code: "BUSY", snapshot: this.getSnapshot() };
    }

    this.setBusy(true);
    try {
      const value = await this.engine.dispatch(
        action,
        context ?? { actor: "human", source: "manual" },
      );
      const snapshot = this.getSnapshot();
      await this.presentationSync(snapshot);
      return { ok: true, snapshot, value };
    } catch (error) {
      return { ok: false, code: "ENGINE_ERROR", error, snapshot: this.getSnapshot() };
    } finally {
      this.finishMutation();
    }
  }

  async dispatchCommand(command: unknown, context?: unknown): Promise<CoordinatorResult> {
    if (this.busy) {
      return { ok: false, code: "BUSY", snapshot: this.getSnapshot() };
    }

    this.setBusy(true);
    try {
      const value = await this.engine.dispatchCommand(command, context);
      const snapshot = this.getSnapshot();
      await this.presentationSync(snapshot);
      return { ok: true, snapshot, value };
    } catch (error) {
      return { ok: false, code: "ENGINE_ERROR", error, snapshot: this.getSnapshot() };
    } finally {
      this.finishMutation();
    }
  }

  async reset(options?: unknown): Promise<CoordinatorResult> {
    if (this.busy) {
      return { ok: false, code: "BUSY", snapshot: this.getSnapshot() };
    }

    this.setBusy(true);
    try {
      const value = await this.engine.reset(options);
      const snapshot = this.getSnapshot();
      await this.presentationSync(snapshot);
      return { ok: true, snapshot, value };
    } catch (error) {
      return { ok: false, code: "ENGINE_ERROR", error, snapshot: this.getSnapshot() };
    } finally {
      this.finishMutation();
    }
  }

  private setBusy(value: boolean) {
    this.busy = value;
    for (const listener of this.subscribers) listener(value);
  }

  private finishMutation() {
    if (this.queuedSteps.length > 0) {
      void this.drainHumanSteps();
      return;
    }
    this.setBusy(false);
  }

  private cancelledResult(snapshot = this.getSnapshot()): DispatchFailure {
    return { ok: false, code: "CANCELLED", snapshot };
  }

  private async drainHumanSteps() {
    if (this.movementDraining) return;
    this.movementDraining = true;
    try {
      while (this.queuedSteps.length > 0) {
        const item = this.queuedSteps.shift();
        if (!item) break;
        const before = this.getSnapshot();
        if (before.phase !== "journey") {
          item.resolve(this.cancelledResult(before));
          this.cancelQueuedSteps();
          break;
        }
        try {
          const value = await this.engine.dispatch(
            { type: "MOVE_STEP", direction: item.direction },
            item.context,
          );
          const snapshot = this.getSnapshot();
          await this.presentationSync(snapshot);
          item.resolve({ ok: true, snapshot, value });
        } catch (error) {
          item.resolve({ ok: false, code: "ENGINE_ERROR", error, snapshot: this.getSnapshot() });
          this.cancelQueuedSteps();
          break;
        }
      }
    } finally {
      this.movementDraining = false;
      if (this.busy) this.setBusy(false);
    }
  }
}
