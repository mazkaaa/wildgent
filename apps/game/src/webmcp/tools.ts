import type {
  GameEngineContext,
  GameEnginePort,
  ToolFailure,
  ToolSuccess,
  WebMcpExecuteOptions,
  WebMcpToolDefinition,
  WebMcpToolResult,
} from "./types";

export const STATIC_TOOL_NAMES = [
  "get_game_state",
  "look_around",
  "move",
  "inspect",
  "interact",
  "get_party",
  "battle_action",
  "ignite",
  "break",
] as const;

export const CAPABILITY_TOOL_NAMES = ["interface"] as const;

const NEVER_ABORT_SIGNAL = new AbortController().signal;

const EMPTY_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

const TARGET_SCHEMA = {
  type: "object",
  properties: {
    targetId: { type: "string", minLength: 1 },
  },
  required: ["targetId"],
  additionalProperties: false,
} as const;

const INTERACT_SCHEMA = {
  type: "object",
  properties: {
    targetId: { type: "string", minLength: 1 },
    intent: { type: "string", minLength: 1 },
  },
  required: ["targetId"],
  additionalProperties: false,
} as const;

const BATTLE_ACTION_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["strike", "defend", "signature", "switch", "environment"] },
    targetId: { type: "string", minLength: 1 },
  },
  required: ["action"],
  additionalProperties: false,
} as const;

function success(result: unknown): ToolSuccess {
  return result === undefined ? { ok: true } : { ok: true, result };
}

function toolResult(result: unknown): WebMcpToolResult {
  if (isRecord(result) && isRecord(result.error) && typeof result.error.code === "string") {
    return failure(
      result.error.code,
      typeof result.error.message === "string" ? result.error.message : "The query was refused.",
      result.error,
    );
  }
  if (!isRecord(result) || result.ok !== false) return success(result);
  const code = typeof result.code === "string" ? result.code : "ENGINE_ERROR";
  const message =
    typeof result.message === "string" ? result.message : "The game refused this action.";
  return failure(code, message, result.error);
}

function failure(code: ToolFailure["code"], message: string, details?: unknown): ToolFailure {
  return details === undefined
    ? { ok: false, code, message }
    : { ok: false, code, message, details };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function signalOf(options?: WebMcpExecuteOptions): AbortSignal {
  return options?.signal ?? NEVER_ABORT_SIGNAL;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function targetId(input: unknown): string | undefined {
  if (!isRecord(input) || typeof input.targetId !== "string" || input.targetId.length === 0) {
    return undefined;
  }
  return input.targetId;
}

function executeContext(toolName: string, signal: AbortSignal): GameEngineContext {
  return { actor: "agent", source: "webmcp", toolName, signal };
}

async function guarded<T>(
  signal: AbortSignal,
  operation: () => T | Promise<T>,
): Promise<WebMcpToolResult> {
  if (signal.aborted) return failure("CANCELLED", "The tool call was cancelled.");

  try {
    return toolResult(await operation());
  } catch (error) {
    if (signal.aborted) return failure("CANCELLED", "The tool call was cancelled.");
    return failure("ENGINE_ERROR", errorMessage(error));
  }
}

async function dispatch(
  engine: GameEnginePort,
  toolName: string,
  command: unknown,
  options?: WebMcpExecuteOptions,
): Promise<WebMcpToolResult> {
  const signal = signalOf(options);
  return guarded(signal, () => engine.dispatch(command, executeContext(toolName, signal)));
}

async function query(
  engine: GameEnginePort,
  _toolName: string,
  request: unknown,
  options?: WebMcpExecuteOptions,
): Promise<WebMcpToolResult> {
  const signal = signalOf(options);
  return guarded(signal, () => engine.query(request));
}

function invalidInput(message: string): WebMcpToolResult {
  return failure("INVALID_INPUT", message);
}

function readOnlyTool(
  name: string,
  description: string,
  inputSchema: unknown,
  execute: WebMcpToolDefinition["execute"],
): WebMcpToolDefinition {
  return {
    name,
    description,
    inputSchema,
    annotations: { readOnlyHint: true },
    execute,
  };
}

function mutationTool(
  name: string,
  description: string,
  inputSchema: unknown,
  execute: WebMcpToolDefinition["execute"],
): WebMcpToolDefinition {
  return { name, description, inputSchema, execute };
}

export function createWebMcpTools(engine: GameEnginePort): WebMcpToolDefinition[] {
  const staticTools: WebMcpToolDefinition[] = [
    readOnlyTool(
      "get_game_state",
      "Read the current game state, phase, visible routes, and agent capabilities.",
      EMPTY_SCHEMA,
      (_input, options) => guarded(signalOf(options), () => engine.getSnapshot()),
    ),
    readOnlyTool(
      "look_around",
      "Inspect the currently visible scene and discover targets that can be used.",
      EMPTY_SCHEMA,
      (_input, options) => query(engine, "look_around", { type: "world" }, options),
    ),
    mutationTool(
      "move",
      "Move to a visible landmark or an available route identified by its target id. Target ids only; coordinates are not accepted.",
      TARGET_SCHEMA,
      (input, options) => {
        const id = targetId(input);
        return id === undefined
          ? invalidInput("move requires a non-empty targetId.")
          : dispatch(engine, "move", { type: "move", targetId: id }, options);
      },
    ),
    mutationTool(
      "inspect",
      "Inspect a visible target identified by its target id.",
      TARGET_SCHEMA,
      (input, options) => {
        const id = targetId(input);
        return id === undefined
          ? invalidInput("inspect requires a non-empty targetId.")
          : dispatch(engine, "inspect", { type: "inspect", targetId: id }, options);
      },
    ),
    mutationTool(
      "interact",
      "Interact with a visible target using an optional concise intent.",
      INTERACT_SCHEMA,
      (input, options) => {
        const id = targetId(input);
        if (id === undefined) return invalidInput("interact requires a non-empty targetId.");
        const intent =
          isRecord(input) && typeof input.intent === "string" ? input.intent : undefined;
        return dispatch(engine, "interact", { type: "interact", targetId: id, intent }, options);
      },
    ),
    readOnlyTool(
      "get_party",
      "Read the current party members, conditions, and available roles.",
      EMPTY_SCHEMA,
      (_input, options) => query(engine, "get_party", { type: "party" }, options),
    ),
    mutationTool(
      "battle_action",
      "Perform one available battle action against the current encounter.",
      BATTLE_ACTION_SCHEMA,
      (input, options) => {
        if (
          !isRecord(input) ||
          !["strike", "defend", "signature", "switch", "environment"].includes(String(input.action))
        ) {
          return invalidInput(
            "battle_action requires strike, defend, signature, switch, or environment.",
          );
        }
        const target = typeof input.targetId === "string" ? input.targetId : undefined;
        return dispatch(
          engine,
          "battle_action",
          { type: "battle_action", action: input.action, targetId: target },
          options,
        );
      },
    ),
    mutationTool(
      "ignite",
      "Ignite a discovered resonance signal by its visible target id.",
      TARGET_SCHEMA,
      (input, options) => {
        const id = targetId(input);
        return id === undefined
          ? invalidInput("ignite requires a non-empty targetId.")
          : dispatch(engine, "ignite", { type: "ignite", targetId: id }, options);
      },
    ),
    mutationTool(
      "break",
      "Break a visible obstacle identified by its target id.",
      TARGET_SCHEMA,
      (input, options) => {
        const id = targetId(input);
        return id === undefined
          ? invalidInput("break requires a non-empty targetId.")
          : dispatch(engine, "break", { type: "break", targetId: id }, options);
      },
    ),
  ];

  return staticTools;
}

export function createCapabilityTools(engine: GameEnginePort): WebMcpToolDefinition[] {
  return [
    mutationTool(
      "interface",
      "Use a discovered resonance interface identified by its target id.",
      TARGET_SCHEMA,
      (input, options) => {
        const id = targetId(input);
        return id === undefined
          ? invalidInput("interface requires a non-empty targetId.")
          : dispatch(engine, "interface", { type: "interface", targetId: id }, options);
      },
    ),
  ];
}
