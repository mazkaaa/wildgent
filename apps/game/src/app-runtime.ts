import type { CardinalDirection, GameAction, GameSnapshot } from "./app-model";
import {
  ActionCoordinator,
  EngineAdapter,
  type PresentationSync,
  type RawEngine,
} from "./engine-adapter";

export type AppRuntime = {
  engine: EngineAdapter;
  coordinator: ActionCoordinator;
  dispatch: (action: GameAction, context?: unknown) => ReturnType<ActionCoordinator["dispatch"]>;
  enqueueHumanStep: (
    direction: CardinalDirection,
    context?: unknown,
  ) => ReturnType<ActionCoordinator["enqueueHumanStep"]>;
  cancelQueuedSteps: () => void;
  dispatchCommand: (
    command: unknown,
    context?: unknown,
  ) => ReturnType<ActionCoordinator["dispatchCommand"]>;
  query: (query: unknown) => Promise<unknown>;
  getSnapshot: () => GameSnapshot;
  subscribe: (listener: (snapshot: GameSnapshot) => void) => () => void;
  reset: (options?: unknown) => ReturnType<ActionCoordinator["reset"]>;
  subscribeBusy: (listener: (busy: boolean) => void) => () => void;
  setPresentationSync: (sync: PresentationSync) => void;
  /** Structural port consumed by the WebMCP adapter without a second state store. */
  gameEnginePort: {
    dispatch: (command: unknown, context?: unknown) => Promise<unknown>;
    query: (query: unknown) => Promise<unknown>;
    getSnapshot: () => unknown;
    subscribe: (listener: (snapshot?: unknown) => void) => () => void;
    reset: (mode?: unknown) => ReturnType<ActionCoordinator["reset"]>;
  };
};

export const createAppRuntime = (rawEngine?: RawEngine): AppRuntime => {
  const engine = new EngineAdapter(rawEngine);
  const coordinator = new ActionCoordinator(engine);
  return {
    engine,
    coordinator,
    dispatch: (action, context) => coordinator.dispatch(action, context),
    enqueueHumanStep: (direction, context) => coordinator.enqueueHumanStep(direction, context),
    cancelQueuedSteps: () => coordinator.cancelQueuedSteps(),
    dispatchCommand: (command, context) => coordinator.dispatchCommand(command, context),
    query: (query) => coordinator.query(query),
    getSnapshot: () => coordinator.getSnapshot(),
    subscribe: (listener) => coordinator.subscribe(listener),
    reset: (options) => coordinator.reset(options),
    subscribeBusy: (listener) => coordinator.subscribeBusy(listener),
    setPresentationSync: (sync) => coordinator.setPresentationSync(sync),
    gameEnginePort: {
      dispatch: async (command, context) => {
        const result = await coordinator.dispatchCommand(command, context);
        if (result.ok) return result.value;
        return {
          ok: false,
          status: "refused",
          code: result.code,
          message:
            result.code === "BUSY"
              ? "Another game mutation is still being presented."
              : "The game engine could not complete the action.",
          snapshot: result.snapshot,
        };
      },
      query: (query) => coordinator.query(query),
      // WebMCP consumers need the complete authoritative aggregate, including visible targets,
      // capabilities, and battle state. The React-facing projection intentionally stays separate.
      getSnapshot: () => engine.raw.getSnapshot(),
      subscribe: (listener) => coordinator.subscribe(() => listener(engine.raw.getSnapshot())),
      reset: (mode) => coordinator.reset(mode),
    },
  };
};

let sharedRuntime: AppRuntime | undefined;

/** Shared seam for the manual UI and the WebMCP adapter. */
export const getAppRuntime = (): AppRuntime => {
  sharedRuntime ??= createAppRuntime();
  return sharedRuntime;
};

export const resetSharedRuntime = () => {
  sharedRuntime = undefined;
};
