import { createGameEngine } from "@wildgent/game-engine";
import { describe, expect, it } from "vitest";

import { type GameAction, type GameSnapshot, INITIAL_SNAPSHOT } from "../app-model";
import { createAppRuntime } from "../app-runtime";
import { ActionCoordinator, EngineAdapter, type RawEngine } from "../engine-adapter";
import { PresentationGate, presentationCuesForTransition } from "../rendering/world-scene";

const fakeEngine = (events: string[], delay = 0): RawEngine => {
  let snapshot: GameSnapshot = { ...INITIAL_SNAPSHOT, activity: [...INITIAL_SNAPSHOT.activity] };
  const listeners = new Set<(value: unknown) => void>();
  return {
    dispatch: async (action: unknown) => {
      events.push(`engine:${String((action as GameAction).type)}`);
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      snapshot = { ...snapshot, version: snapshot.version + 1, phase: "journey" };
      listeners.forEach((listener) => {
        listener(snapshot);
      });
      return { accepted: true };
    },
    query: async (query: unknown) => {
      events.push(`query:${String(query)}`);
      return snapshot;
    },
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset: async () => {
      events.push("engine:reset");
      snapshot = INITIAL_SNAPSHOT;
      return undefined;
    },
  };
};

describe("ActionCoordinator", () => {
  it("acquires the lock synchronously before returning an idle step promise", async () => {
    const raw = fakeEngine([]);
    raw.getSnapshot = () => ({ ...INITIAL_SNAPSHOT, phase: "journey" });
    const coordinator = new ActionCoordinator(new EngineAdapter(raw));
    coordinator.setPresentationSync(() => undefined);

    const step = coordinator.enqueueHumanStep("east");
    expect(coordinator.isBusy).toBe(true);
    const dispatch = coordinator.dispatch({ type: "START_DEMO" });
    const command = coordinator.dispatchCommand({ type: "ignite", targetId: "echo-beacon" });
    const reset = coordinator.reset();
    await expect(dispatch).resolves.toMatchObject({
      ok: false,
      code: "BUSY",
    });
    await expect(command).resolves.toMatchObject({ ok: false, code: "BUSY" });
    await expect(reset).resolves.toMatchObject({ ok: false, code: "BUSY" });
    await expect(step).resolves.toMatchObject({ ok: true });
  });

  it("hands the active lock directly from a regular mutation to queued steps", async () => {
    const events: string[] = [];
    let releaseRegular!: () => void;
    let snapshot: GameSnapshot = {
      ...INITIAL_SNAPSHOT,
      phase: "journey",
      activity: [...INITIAL_SNAPSHOT.activity],
    };
    const raw = fakeEngine(events) as RawEngine;
    raw.getSnapshot = () => snapshot;
    raw.dispatch = async (action: unknown) => {
      const command = action as { type?: string; direction?: string };
      events.push(`engine:${command.type}`);
      if (command.type === "START_JOURNEY")
        await new Promise<void>((resolve) => (releaseRegular = resolve));
      if (command.type === "STEP") snapshot = { ...snapshot, position: { x: 2, y: 1 } };
      return { ok: true };
    };
    const coordinator = new ActionCoordinator(new EngineAdapter(raw));
    coordinator.setPresentationSync(() => undefined);
    const busyEvents: boolean[] = [];
    coordinator.subscribeBusy((busy) => busyEvents.push(busy));

    const regular = coordinator.dispatch({ type: "START_JOURNEY" });
    const step = coordinator.enqueueHumanStep("east");
    expect(busyEvents).toEqual([false, true]);
    releaseRegular();
    await expect(regular).resolves.toMatchObject({ ok: true });
    await expect(step).resolves.toMatchObject({ ok: true, snapshot: { position: { x: 2, y: 1 } } });
    expect(events).toEqual(["engine:START_JOURNEY", "engine:STEP"]);
    expect(busyEvents).toEqual([false, true, false]);
  });

  it("drains every queued human step in order and holds the mutation lock across presentation", async () => {
    const events: string[] = [];
    let snapshot: GameSnapshot = {
      ...INITIAL_SNAPSHOT,
      phase: "journey",
      position: { x: 1, y: 1 },
      activity: [...INITIAL_SNAPSHOT.activity],
    };
    const raw = fakeEngine(events) as RawEngine;
    raw.getSnapshot = () => snapshot;
    raw.dispatch = async (action: unknown) => {
      const command = action as { type?: string; direction?: string };
      events.push(`engine:${command.type}:${command.direction ?? ""}`);
      if (command.type === "STEP") {
        snapshot = {
          ...snapshot,
          position: {
            x:
              snapshot.position.x +
              (command.direction === "east" ? 1 : command.direction === "west" ? -1 : 0),
            y:
              snapshot.position.y +
              (command.direction === "south" ? 1 : command.direction === "north" ? -1 : 0),
          },
        };
      }
      return { ok: true };
    };
    const coordinator = new ActionCoordinator(new EngineAdapter(raw));
    const presentations: Array<() => void> = [];
    coordinator.setPresentationSync(
      () =>
        new Promise<void>((resolve) => {
          presentations.push(resolve);
        }),
    );

    const first = coordinator.enqueueHumanStep("east");
    const second = coordinator.enqueueHumanStep("south");
    const third = coordinator.enqueueHumanStep("west");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(["engine:STEP:east"]);
    expect(coordinator.isBusy).toBe(true);
    expect(await coordinator.dispatch({ type: "START_DEMO" })).toMatchObject({
      ok: false,
      code: "BUSY",
    });

    presentations.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(["engine:STEP:east", "engine:STEP:south"]);
    presentations.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(["engine:STEP:east", "engine:STEP:south", "engine:STEP:west"]);
    presentations.shift()?.();

    await expect(first).resolves.toMatchObject({
      ok: true,
      snapshot: { position: { x: 2, y: 1 } },
    });
    await expect(second).resolves.toMatchObject({
      ok: true,
      snapshot: { position: { x: 2, y: 2 } },
    });
    await expect(third).resolves.toMatchObject({
      ok: true,
      snapshot: { position: { x: 1, y: 2 } },
    });
    expect(coordinator.isBusy).toBe(false);
  });

  it("continues after a domain refusal and cancels the remainder after a thrown failure", async () => {
    let snapshot: GameSnapshot = {
      ...INITIAL_SNAPSHOT,
      phase: "journey",
      position: { x: 0, y: 0 },
      activity: [...INITIAL_SNAPSHOT.activity],
    };
    const raw = fakeEngine([]) as RawEngine;
    raw.getSnapshot = () => snapshot;
    raw.dispatch = async (action: unknown) => {
      const command = action as { type?: string; direction?: string };
      if (command.direction === "west") return { ok: false, code: "INVALID_POSITION" };
      if (command.direction === "south") throw new Error("presentation boundary");
      snapshot = { ...snapshot, position: { x: 0, y: 1 } };
      return { ok: true };
    };
    const coordinator = new ActionCoordinator(new EngineAdapter(raw));
    coordinator.setPresentationSync(() => undefined);
    const refused = coordinator.enqueueHumanStep("west");
    const thrown = coordinator.enqueueHumanStep("south");
    const cancelled = coordinator.enqueueHumanStep("east");

    await expect(refused).resolves.toMatchObject({
      ok: true,
      value: { ok: false, code: "INVALID_POSITION" },
    });
    await expect(thrown).resolves.toMatchObject({ ok: false, code: "ENGINE_ERROR" });
    await expect(cancelled).resolves.toMatchObject({ ok: false, code: "CANCELLED" });
    expect(coordinator.isBusy).toBe(false);
    expect(snapshot.position).toEqual({ x: 0, y: 0 });
  });

  it("settles queued steps as cancelled exactly once when cancelled", async () => {
    let releasePresentation!: () => void;
    const raw = fakeEngine([]) as RawEngine;
    raw.getSnapshot = () => ({
      ...INITIAL_SNAPSHOT,
      phase: "journey",
      activity: [...INITIAL_SNAPSHOT.activity],
    });
    const coordinator = new ActionCoordinator(new EngineAdapter(raw));
    coordinator.setPresentationSync(
      () =>
        new Promise<void>((resolve) => {
          releasePresentation = resolve;
        }),
    );
    const active = coordinator.enqueueHumanStep("east");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const queued = coordinator.enqueueHumanStep("east");
    let queuedSettlements = 0;
    void queued.then(() => {
      queuedSettlements += 1;
    });
    coordinator.cancelQueuedSteps();
    coordinator.cancelQueuedSteps();
    await expect(queued).resolves.toMatchObject({ ok: false, code: "CANCELLED" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queuedSettlements).toBe(1);
    releasePresentation();
    await expect(active).resolves.toMatchObject({ ok: true });
    expect(coordinator.isBusy).toBe(false);
  });

  it("settles superseded presentation requests exactly once", async () => {
    const gate = new PresentationGate();
    const first = gate.begin("A");
    let firstSettlements = 0;
    first.then(() => {
      firstSettlements += 1;
    });

    const second = gate.begin("B");
    await Promise.resolve();
    expect(firstSettlements).toBe(1);
    expect(gate.key).toBe("B");
    expect(gate.begin("B")).toBe(second);

    gate.settle();
    gate.settle();
    await second;
    expect(gate.isPending).toBe(false);
  });

  it("derives world cues from authoritative transitions without changing the marker actor", () => {
    const previous: GameSnapshot = {
      ...INITIAL_SNAPSHOT,
      phase: "journey",
      flags: { ...INITIAL_SNAPSHOT.flags, beaconLit: true },
      activity: [...INITIAL_SNAPSHOT.activity],
    };
    const current: GameSnapshot = {
      ...previous,
      version: previous.version + 1,
      flags: {
        ...previous.flags,
        resonanceCalibrated: true,
        rubbleCleared: true,
      },
      activity: [
        ...previous.activity,
        {
          id: "echo-break",
          kind: "echo",
          actor: "echo",
          commandType: "break",
          label: "Echo cleared the rubble",
          detail: "The path opens.",
          timestamp: Date.now(),
          accepted: true,
        },
      ],
    };

    expect(presentationCuesForTransition(previous, current)).toEqual([
      { type: "resonance", landmark: "relay-station", actor: "echo" },
      {
        type: "capability",
        capability: "break",
        landmark: "ruins-rubble",
        actor: "echo",
      },
    ]);
  });

  it("projects authoritative engine position without a second visual cursor", async () => {
    const events: string[] = [];
    const raw = fakeEngine(events) as RawEngine;
    const adapter = new EngineAdapter(raw);
    expect(adapter.getSnapshot().position).toEqual({ x: 1, y: 1 });

    await adapter.dispatch({ type: "MOVE_STEP", direction: "east" });
    expect(events).toEqual(["engine:STEP"]);
    expect(adapter.getSnapshot().position).toEqual({ x: 1, y: 1 });
  });

  it("maps direct tile, travel, and landmark actions to engine commands", async () => {
    const commands: unknown[] = [];
    const raw = fakeEngine([]);
    raw.dispatch = async (command) => {
      commands.push(command);
      return { ok: true };
    };
    const adapter = new EngineAdapter(raw);

    await adapter.dispatch({ type: "MOVE_TO", position: { x: 4, y: 2 } });
    await adapter.dispatch({ type: "TRAVEL_TO", zone: "ruins" });
    await adapter.dispatch({ type: "INTERACT", landmark: "relay-station" });
    await adapter.dispatch({ type: "ATTACK", move: "environment" });

    expect(commands).toEqual([
      { type: "MOVE_TO_POSITION", position: { x: 4, y: 2 } },
      { type: "MOVE", targetId: "ruins" },
      { type: "MOVE", targetId: "relay" },
      { type: "BREAK", targetId: "voltyn-relay" },
      { type: "BATTLE_ACTION", action: "environment" },
    ]);
  });

  it("keeps the WebMCP port on the authoritative engine aggregate", async () => {
    const engine = createGameEngine({ persist: false });
    const runtime = createAppRuntime(engine as unknown as RawEngine);

    expect(runtime.gameEnginePort.getSnapshot()).toMatchObject({
      capabilities: ["ignite", "break"],
      beaconLit: false,
    });

    const result = await runtime.gameEnginePort.dispatch({
      type: "ignite",
      targetId: "echo-beacon",
    });
    expect(result).toMatchObject({ ok: true, status: "accepted" });
    expect(runtime.gameEnginePort.getSnapshot()).toMatchObject({ beaconLit: true });
  });

  it("blocks WebMCP mutations while the human pauses the expedition", async () => {
    const engine = createGameEngine({ persist: false });
    const runtime = createAppRuntime(engine as unknown as RawEngine);

    runtime.setPaused(true);
    expect(runtime.isPaused()).toBe(true);
    await expect(
      runtime.gameEnginePort.dispatch({ type: "ignite", targetId: "echo-beacon" }),
    ).resolves.toMatchObject({ ok: false, code: "BUSY" });
    expect(runtime.gameEnginePort.getSnapshot()).toMatchObject({ beaconLit: false });

    runtime.setPaused(false);
    await expect(
      runtime.gameEnginePort.dispatch({ type: "ignite", targetId: "echo-beacon" }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("locks a mutation until engine state and presentation sync finish", async () => {
    const events: string[] = [];
    const coordinator = new ActionCoordinator(new EngineAdapter(fakeEngine(events, 5)));
    coordinator.setPresentationSync(async () => {
      events.push("presentation");
      await new Promise((resolve) => setTimeout(resolve, 5));
      events.push("presentation:done");
    });

    const first = coordinator.dispatch({ type: "START_JOURNEY" });
    expect(coordinator.isBusy).toBe(true);
    const refused = await coordinator.dispatch({ type: "START_DEMO" });
    expect(refused).toMatchObject({ ok: false, code: "BUSY" });
    const completed = await first;

    expect(completed.ok).toBe(true);
    expect(events).toEqual(["engine:START_JOURNEY", "presentation", "presentation:done"]);
    expect(coordinator.isBusy).toBe(false);
  });

  it("allows queries while a mutation is presenting", async () => {
    const events: string[] = [];
    const coordinator = new ActionCoordinator(new EngineAdapter(fakeEngine(events)));
    let releasePresentation!: () => void;
    const presentation = new Promise<void>((resolve) => {
      releasePresentation = resolve;
    });
    coordinator.setPresentationSync(async () => presentation);

    const mutation = coordinator.dispatch({ type: "START_JOURNEY" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const query = await coordinator.query("snapshot");
    expect(query).toBeTruthy();
    expect(coordinator.isBusy).toBe(true);
    releasePresentation();
    await mutation;
    expect(events).toContain("query:snapshot");
  });
});
