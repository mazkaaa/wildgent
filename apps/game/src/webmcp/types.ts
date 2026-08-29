/**
 * The WebMCP API is not yet part of lib.dom in the TypeScript version used by
 * this repository. These deliberately narrow structural types keep the
 * browser adaptation local to this directory.
 */
export interface WebMcpExecuteOptions {
  signal: AbortSignal;
}

export interface WebMcpToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema?: unknown;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
  };
  execute: (input: unknown, options?: WebMcpExecuteOptions) => unknown | Promise<unknown>;
}

export interface WebMcpRegistrationOptions {
  signal?: AbortSignal;
  exposedTo?: string[];
}

export interface WebMcpModelContext {
  registerTool: (tool: WebMcpToolDefinition, options?: WebMcpRegistrationOptions) => Promise<void>;
}

export interface WebMcpDocument {
  readonly modelContext?: WebMcpModelContext;
}

export interface WebMcpWindow {
  readonly isSecureContext?: boolean;
  readonly crossOriginIsolated?: boolean;
}

export interface GameEngineContext {
  actor: "agent";
  source: "webmcp";
  toolName: string;
  signal: AbortSignal;
}

export interface GameEnginePort {
  dispatch: (command: unknown, context: GameEngineContext) => unknown | Promise<unknown>;
  query: (query: unknown) => unknown | Promise<unknown>;
  getSnapshot: () => unknown;
  subscribe?: (listener: (snapshot?: unknown) => void) => (() => void) | undefined;
  reset?: (mode: unknown) => unknown | Promise<unknown>;
}

export interface ToolSuccess {
  ok: true;
  result?: unknown;
}

export interface ToolFailure {
  ok: false;
  code: string;
  message: string;
  details?: unknown;
}

export type WebMcpToolResult = ToolSuccess | ToolFailure;

export interface WebMcpPreflight {
  available: boolean;
  secureContext: boolean | undefined;
  originIsolated: boolean | undefined;
  permissionsPolicy: "unknown";
  reason?: string;
}

export interface RegistrationFailure {
  name: string;
  error: unknown;
}

export interface RegistrationReport {
  registered: string[];
  alreadyRegistered: string[];
  duplicates: string[];
  failures: RegistrationFailure[];
}
