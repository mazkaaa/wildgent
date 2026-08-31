import { createGameEngine } from "@wildgent/game-engine";
import { describe, expect, it, vi } from "vitest";
import { createAppRuntime } from "../app-runtime";
import type { RawEngine } from "../engine-adapter";
import { createWebMcpIntegration, registerWebMcp } from "./index";
import type { GameEnginePort, WebMcpModelContext, WebMcpToolDefinition } from "./types";

type Registered = { tool: WebMcpToolDefinition; signal?: AbortSignal };

function fakeEngine(initial: unknown = { resonance: false }) {
  let snapshot = initial;
  let listener: ((snapshot?: unknown) => void) | undefined;
  const engine: GameEnginePort = {
    dispatch: vi.fn(async (command) => ({ command })),
    query: vi.fn(async (query) => ({ query })),
    getSnapshot: vi.fn(() => snapshot),
    subscribe: vi.fn((next) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    }),
  };
  return {
    engine,
    setSnapshot(next: unknown) {
      snapshot = next;
      listener?.(snapshot);
    },
  };
}

function fakeContext(options: { duplicate?: string } = {}) {
  const registered: Registered[] = [];
  const context: WebMcpModelContext = {
    registerTool: vi.fn(async (tool, registrationOptions) => {
      if (tool.name === options.duplicate) {
        throw new DOMException("Tool already registered", "InvalidStateError");
      }
      registered.push({ tool, signal: registrationOptions?.signal });
    }),
  };
  return { context, registered };
}

const browser = (modelContext: WebMcpModelContext) => ({
  modelContext,
});

describe("WebMCP integration", () => {
  it("moves visible landmarks through the authoritative engine while hiding undiscovered routes", async () => {
    const runtime = createAppRuntime(createGameEngine({ persist: false }) as unknown as RawEngine);
    const enginePort = runtime.gameEnginePort;
    const { context, registered } = fakeContext();
    const integration = createWebMcpIntegration(enginePort, { document: browser(context) });
    await integration.register();
    const move = registered.find(({ tool }) => tool.name === "move")?.tool;
    expect(move).toBeDefined();

    await runtime.dispatch({ type: "START_DEMO" });
    const relay = await move?.execute({ targetId: "voltyn-relay" });
    expect(relay).toMatchObject({ ok: true });
    expect(enginePort.getSnapshot()).toMatchObject({ position: { x: 5, y: 2 } });

    const hidden = await move?.execute({ targetId: "maintenance-path" });
    expect(hidden).toMatchObject({ ok: false, code: "HUMAN_DISCOVERY_REQUIRED" });
    integration.dispose();
  });

  it("feature-detects the canonical document.modelContext surface", () => {
    const engine = fakeEngine().engine;
    const unsupported = createWebMcpIntegration(engine, { document: {} });
    expect(unsupported.preflight()).toMatchObject({
      available: false,
      permissionsPolicy: "unknown",
    });

    const { context } = fakeContext();
    const supported = createWebMcpIntegration(engine, {
      document: browser(context),
      window: { isSecureContext: true, crossOriginIsolated: true },
    });
    expect(supported.preflight()).toMatchObject({
      available: true,
      secureContext: true,
      originIsolated: true,
    });
  });

  it("reports checking while registration is pending and ready after a clean pass", async () => {
    const { engine } = fakeEngine();
    const { context } = fakeContext();
    const registration = registerWebMcp(engine, {
      document: browser(context),
      window: { isSecureContext: true, crossOriginIsolated: true },
    });

    expect(registration.getStatus()).toMatchObject({
      phase: "checking",
      available: true,
      secureContext: true,
      originIsolated: true,
      registeredTools: [],
      failures: [],
    });

    await registration.ready;

    expect(registration.getStatus()).toMatchObject({
      phase: "ready",
      registeredTools: expect.arrayContaining([
        "get_game_state",
        "look_around",
        "move",
        "inspect",
        "interact",
        "get_party",
        "battle_action",
        "ignite",
        "break",
      ]),
      failures: [],
    });
  });

  it("reports unsupported feature detection as unavailable", async () => {
    const { engine } = fakeEngine();
    const registration = registerWebMcp(engine, { document: {} });

    expect(registration.getStatus()).toMatchObject({
      phase: "unavailable",
      available: false,
      registeredTools: [],
      failures: [],
    });
    await registration.ready;
    expect(registration.getStatus().phase).toBe("unavailable");
  });

  it("reports sanitized registration failures as attention", async () => {
    const { engine } = fakeEngine();
    const registered: Registered[] = [];
    const context: WebMcpModelContext = {
      registerTool: vi.fn(async (tool, registrationOptions) => {
        if (tool.name === "move") {
          throw new Error("secret-token should never reach the UI");
        }
        registered.push({ tool, signal: registrationOptions?.signal });
      }),
    };
    const registration = registerWebMcp(engine, { document: browser(context) });

    const result = await registration.ready;
    const status = registration.getStatus();

    expect(result.failures).toHaveLength(1);
    expect(status.phase).toBe("attention");
    expect(status.failures).toEqual([{ name: "move", message: "Tool registration failed." }]);
    expect(JSON.stringify(status)).not.toContain("secret-token");
    expect(status.failures[0]).not.toHaveProperty("error");
    expect(registered).toHaveLength(8);
  });

  it("does not expose custom exception names in sanitized failures", async () => {
    const { engine } = fakeEngine();
    const { context } = fakeContext();
    context.registerTool = vi.fn(async (tool) => {
      if (tool.name === "move") {
        const error = new Error("private registration detail");
        error.name = "secret-error-name";
        throw error;
      }
    });
    const registration = registerWebMcp(engine, { document: browser(context) });

    await registration.ready;

    expect(registration.getStatus().failures).toEqual([
      { name: "move", message: "Tool registration failed." },
    ]);
    expect(JSON.stringify(registration.getStatus())).not.toContain("secret-error-name");
  });

  it("publishes status updates to subscribers, including dynamic interface registration", async () => {
    const { engine, setSnapshot } = fakeEngine({ resonance: false });
    const { context, registered } = fakeContext();
    const registration = registerWebMcp(engine, { document: browser(context) });
    const updates: string[][] = [];
    const unsubscribe = registration.subscribeStatus((status) => {
      updates.push([...status.registeredTools]);
    });

    await registration.ready;
    setSnapshot({ resonance: true });
    await vi.waitFor(() => {
      expect(registered.map(({ tool }) => tool.name)).toContain("interface");
      expect(updates).toEqual(expect.arrayContaining([expect.arrayContaining(["interface"])]));
    });

    const updateCount = updates.length;
    unsubscribe();
    setSnapshot({ resonance: false });
    await Promise.resolve();
    expect(updates).toHaveLength(updateCount);
  });

  it("isolates status snapshots between subscribers", async () => {
    const { engine } = fakeEngine();
    const { context } = fakeContext();
    const first = vi.fn((status) => {
      (status.registeredTools as string[]).push("tampered");
      (status.failures as Array<{ name: string }>).push({ name: "tampered" });
    });
    const second = vi.fn();
    const integration = createWebMcpIntegration(engine, { document: browser(context) });
    integration.subscribeStatus(first);
    integration.subscribeStatus(second);

    await integration.register();

    const latest = second.mock.calls[second.mock.calls.length - 1]?.[0];
    expect(latest.registeredTools).not.toContain("tampered");
    expect(latest.failures).toEqual([]);
    expect(integration.getStatus().registeredTools).not.toContain("tampered");
  });

  it("registers the nine startup tools and is idempotent", async () => {
    const { engine } = fakeEngine();
    const { context, registered } = fakeContext();
    const integration = createWebMcpIntegration(engine, { document: browser(context) });

    const first = await integration.register();
    const second = await integration.register();

    expect(first.registered).toHaveLength(9);
    expect(second.registered).toHaveLength(0);
    expect(second.alreadyRegistered).toHaveLength(9);
    expect(registered.map(({ tool }) => tool.name)).toEqual([
      "get_game_state",
      "look_around",
      "move",
      "inspect",
      "interact",
      "get_party",
      "battle_action",
      "ignite",
      "break",
    ]);
  });

  it("uses fresh engine state and dispatches through the public port", async () => {
    const { engine } = fakeEngine({ turn: 4 });
    const { context, registered } = fakeContext();
    const integration = createWebMcpIntegration(engine, { document: browser(context) });
    await integration.register();
    const getState = registered.find(({ tool }) => tool.name === "get_game_state")?.tool;
    const move = registered.find(({ tool }) => tool.name === "move")?.tool;
    expect(getState).toBeDefined();
    expect(move).toBeDefined();

    const state = await getState?.execute({});
    const moved = await move?.execute(
      { targetId: "north" },
      { signal: new AbortController().signal },
    );

    expect(state).toEqual({ ok: true, result: { turn: 4 } });
    expect(moved).toEqual({ ok: true, result: { command: { type: "move", targetId: "north" } } });
    expect(engine.dispatch).toHaveBeenCalledWith(
      { type: "move", targetId: "north" },
      expect.objectContaining({ actor: "agent", source: "webmcp", toolName: "move" }),
    );
  });

  it("returns structured validation failures before dispatch", async () => {
    const { engine } = fakeEngine();
    const { context, registered } = fakeContext();
    const integration = createWebMcpIntegration(engine, { document: browser(context) });
    await integration.register();
    const move = registered.find(({ tool }) => tool.name === "move")?.tool;

    expect(move?.execute({}, { signal: new AbortController().signal })).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      message: "move requires a non-empty targetId.",
    });
    expect(engine.dispatch).not.toHaveBeenCalled();
  });

  it("preserves structured domain refusals from the shared engine", async () => {
    const { engine } = fakeEngine();
    engine.dispatch = vi.fn(async () => ({
      ok: false,
      code: "HUMAN_DISCOVERY_REQUIRED",
      message: "A human must discover the maintenance route.",
    }));
    const { context, registered } = fakeContext();
    const integration = createWebMcpIntegration(engine, { document: browser(context) });
    await integration.register();
    const interact = registered.find(({ tool }) => tool.name === "interact")?.tool;

    await expect(interact?.execute({ targetId: "maintenance-path" })).resolves.toEqual({
      ok: false,
      code: "HUMAN_DISCOVERY_REQUIRED",
      message: "A human must discover the maintenance route.",
    });
  });

  it("advertises and dispatches the planned battle action vocabulary", async () => {
    const { engine } = fakeEngine();
    const { context, registered } = fakeContext();
    const integration = createWebMcpIntegration(engine, { document: browser(context) });
    await integration.register();
    const battle = registered.find(({ tool }) => tool.name === "battle_action")?.tool;
    const schema = battle?.inputSchema as {
      properties: { action: { enum: string[] } };
    };

    expect(schema.properties.action.enum).toEqual([
      "strike",
      "defend",
      "signature",
      "switch",
      "environment",
    ]);
    await battle?.execute({ action: "signature" });
    expect(engine.dispatch).toHaveBeenCalledWith(
      { type: "battle_action", action: "signature", targetId: undefined },
      expect.anything(),
    );
  });

  it("maps world, party, and inspection tools onto supported engine operations", async () => {
    const { engine } = fakeEngine();
    const { context, registered } = fakeContext();
    const integration = createWebMcpIntegration(engine, { document: browser(context) });
    await integration.register();

    await registered.find(({ tool }) => tool.name === "look_around")?.tool.execute({});
    await registered.find(({ tool }) => tool.name === "get_party")?.tool.execute({});
    await registered
      .find(({ tool }) => tool.name === "inspect")
      ?.tool.execute({ targetId: "ruin-door" });

    expect(engine.query).toHaveBeenCalledWith({ type: "world" });
    expect(engine.query).toHaveBeenCalledWith({ type: "party" });
    expect(engine.dispatch).toHaveBeenCalledWith(
      { type: "inspect", targetId: "ruin-door" },
      expect.objectContaining({ actor: "agent", source: "webmcp", toolName: "inspect" }),
    );
  });

  it("adds interface after resonance and retains it until dispose", async () => {
    const { engine, setSnapshot } = fakeEngine({ resonance: false });
    const { context, registered } = fakeContext();
    const integration = createWebMcpIntegration(engine, { document: browser(context) });
    await integration.register();
    expect(registered).toHaveLength(9);
    expect(registered.map(({ tool }) => tool.name)).toEqual(
      expect.arrayContaining(["ignite", "break"]),
    );

    setSnapshot({ flags: { resonanceCalibrated: true } });
    await vi.waitFor(() => {
      expect(registered.map(({ tool }) => tool.name)).toEqual(
        expect.arrayContaining(["ignite", "break", "interface"]),
      );
    });

    const capabilityRegistrations = registered.filter(({ tool }) =>
      ["ignite", "break", "interface"].includes(tool.name),
    );
    setSnapshot({ flags: { resonanceCalibrated: false } });
    await Promise.resolve();
    expect(capabilityRegistrations.every(({ signal }) => !signal?.aborted)).toBe(true);

    integration.dispose();
    expect(engine.subscribe).toHaveBeenCalled();
    expect(capabilityRegistrations.every(({ signal }) => signal?.aborted)).toBe(true);
  });

  it("reports an externally-owned duplicate without losing other tools", async () => {
    const { engine } = fakeEngine();
    const { context } = fakeContext({ duplicate: "move" });
    const integration = createWebMcpIntegration(engine, { document: browser(context) });

    const result = await integration.register();

    expect(result.duplicates).toEqual(["move"]);
    expect(result.registered).toHaveLength(8);
    expect(integration.getStatus()).toMatchObject({
      phase: "ready",
      registeredTools: expect.arrayContaining(["move"]),
      failures: [],
    });
  });

  it("aborts all registrations on dispose", async () => {
    const { engine } = fakeEngine();
    const { context, registered } = fakeContext();
    const integration = createWebMcpIntegration(engine, { document: browser(context) });
    await integration.register();
    integration.dispose();
    expect(registered.every(({ signal }) => signal?.aborted)).toBe(true);
  });

  it("cleans status subscriptions on disposal", async () => {
    const { engine, setSnapshot } = fakeEngine();
    const { context } = fakeContext();
    const integration = createWebMcpIntegration(engine, { document: browser(context) });
    const listener = vi.fn();
    integration.subscribeStatus(listener);

    await integration.register();
    const callsBeforeDispose = listener.mock.calls.length;
    integration.dispose();
    setSnapshot({ resonance: true });
    await Promise.resolve();

    expect(listener).toHaveBeenCalledTimes(callsBeforeDispose);
    expect(() => integration.subscribeStatus(listener)).not.toThrow();
  });

  it("does not fabricate a failure when disposal aborts an in-flight registration", async () => {
    const { engine } = fakeEngine();
    const { context } = fakeContext();
    let rejectPending: ((reason?: unknown) => void) | undefined;
    context.registerTool = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPending = reject;
        }),
    );
    const integration = createWebMcpIntegration(engine, { document: browser(context) });
    const ready = integration.register();
    await vi.waitFor(() => expect(context.registerTool).toHaveBeenCalled());

    integration.dispose();
    rejectPending?.(new Error("late failure after disposal"));
    const result = await ready;

    expect(result.failures).toEqual([]);
    expect(integration.getStatus()).toMatchObject({ phase: "checking", failures: [] });
  });

  it("does not report a late successful registration after disposal", async () => {
    const { engine } = fakeEngine();
    const { context } = fakeContext();
    let resolvePending: (() => void) | undefined;
    context.registerTool = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePending = resolve;
        }),
    );
    const integration = createWebMcpIntegration(engine, { document: browser(context) });
    const ready = integration.register();
    await vi.waitFor(() => expect(context.registerTool).toHaveBeenCalled());

    integration.dispose();
    resolvePending?.();
    const result = await ready;

    expect(result.registered).toEqual([]);
    expect(result.duplicates).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it("does not report a late duplicate registration after disposal", async () => {
    const { engine } = fakeEngine();
    const { context } = fakeContext();
    let rejectPending: ((reason?: unknown) => void) | undefined;
    context.registerTool = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPending = reject;
        }),
    );
    const integration = createWebMcpIntegration(engine, { document: browser(context) });
    const ready = integration.register();
    await vi.waitFor(() => expect(context.registerTool).toHaveBeenCalled());

    integration.dispose();
    rejectPending?.(new DOMException("Tool already registered", "InvalidStateError"));
    const result = await ready;

    expect(result.registered).toEqual([]);
    expect(result.duplicates).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it("starts registration from the app-facing registerWebMcp entrypoint", async () => {
    const { engine } = fakeEngine();
    const { context, registered } = fakeContext();
    const registration = registerWebMcp(engine, { document: browser(context) });

    const result = await registration.ready;

    expect(result.registered).toHaveLength(9);
    expect(registration.preflight().available).toBe(true);
    registration.dispose();
    expect(registered.every(({ signal }) => signal?.aborted)).toBe(true);
  });
});
