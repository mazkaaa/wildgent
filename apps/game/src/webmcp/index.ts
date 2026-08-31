import {
  CAPABILITY_TOOL_NAMES,
  createCapabilityTools,
  createWebMcpTools,
  STATIC_TOOL_NAMES,
} from "./tools";
import type {
  GameEnginePort,
  RegistrationFailure,
  RegistrationReport,
  WebMcpDocument,
  WebMcpModelContext,
  WebMcpPreflight,
  WebMcpStatusListener,
  WebMcpToolDefinition,
  WebMcpUiFailure,
  WebMcpUiStatus,
  WebMcpUiStatusPhase,
  WebMcpWindow,
} from "./types";

export * from "./tools";
export * from "./types";

function browserDocument(): WebMcpDocument | undefined {
  return typeof document === "undefined" ? undefined : (document as unknown as WebMcpDocument);
}

function browserWindow(): WebMcpWindow | undefined {
  return typeof window === "undefined" ? undefined : window;
}

function modelContextOf(documentLike: WebMcpDocument | undefined): WebMcpModelContext | undefined {
  try {
    const context = documentLike?.modelContext;
    return context && typeof context.registerTool === "function" ? context : undefined;
  } catch {
    return undefined;
  }
}

function report(): RegistrationReport {
  return { registered: [], alreadyRegistered: [], duplicates: [], failures: [] };
}

function failureCode(error: unknown): string {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) return error.name;
  if (error instanceof Error) return error.name;
  return "";
}

const SAFE_BROWSER_FAILURE_CODES = new Set([
  "AbortError",
  "ConstraintError",
  "DataCloneError",
  "DataError",
  "EncodingError",
  "HierarchyRequestError",
  "IndexSizeError",
  "InvalidCharacterError",
  "InvalidModificationError",
  "InvalidStateError",
  "NamespaceError",
  "NetworkError",
  "NoModificationAllowedError",
  "NotAllowedError",
  "NotFoundError",
  "NotReadableError",
  "NotSupportedError",
  "OperationError",
  "QuotaExceededError",
  "ReadOnlyError",
  "SecurityError",
  "SyntaxError",
  "TimeoutError",
  "TransactionInactiveError",
  "UnknownError",
  "URLMismatchError",
  "VersionError",
  "WrongDocumentError",
]);

function isDuplicate(error: unknown): boolean {
  return (
    failureCode(error) === "InvalidStateError" ||
    /duplicate|already registered/i.test(String(error))
  );
}

export interface WebMcpIntegrationOptions {
  document?: WebMcpDocument;
  window?: WebMcpWindow;
  hasResonance?: (snapshot: unknown) => boolean;
  onError?: (failure: RegistrationFailure) => void;
}

export interface WebMcpIntegration {
  preflight(): WebMcpPreflight;
  register(): Promise<RegistrationReport>;
  getStatus(): WebMcpUiStatus;
  subscribeStatus(listener: WebMcpStatusListener): () => void;
  dispose(): void;
}

export interface WebMcpRegistration extends WebMcpIntegration {
  /** Resolves when the initial static/capability registration pass completes. */
  readonly ready: Promise<RegistrationReport>;
}

const defaultHasResonance = (snapshot: unknown): boolean => {
  if (typeof snapshot !== "object" || snapshot === null) return false;
  const value = snapshot as Record<string, unknown>;
  if (value.resonance === true || value.phase === "resonance" || value.phase === "RESONANCE")
    return true;
  if (value.voltynResonance === true) return true;
  if (
    typeof value.resonance === "object" &&
    value.resonance !== null &&
    (value.resonance as Record<string, unknown>).occurred === true
  )
    return true;
  if (Array.isArray(value.capabilities) && value.capabilities.includes("interface")) return true;
  for (const key of ["flags", "capabilities"]) {
    const nested = value[key];
    if (
      typeof nested === "object" &&
      nested !== null &&
      ((nested as Record<string, unknown>).resonance === true ||
        (nested as Record<string, unknown>).resonanceCalibrated === true)
    ) {
      return true;
    }
  }
  return false;
};

class WebMcpIntegrationImpl implements WebMcpIntegration {
  private readonly documentLike: WebMcpDocument | undefined;
  private readonly windowLike: WebMcpWindow | undefined;
  private readonly context: WebMcpModelContext | undefined;
  private readonly hasResonance: (snapshot: unknown) => boolean;
  private readonly onError: ((failure: RegistrationFailure) => void) | undefined;
  private readonly staticTools: WebMcpToolDefinition[];
  private readonly capabilityTools: WebMcpToolDefinition[];
  private readonly registered = new Set<string>();
  private readonly pending = new Map<string, Promise<"registered" | "duplicate" | "failed">>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly statusFailures = new Map<string, WebMcpUiFailure>();
  private readonly statusListeners = new Set<WebMcpStatusListener>();
  private unsubscribe: (() => void) | undefined;
  private disposed = false;
  private registrationPromise: Promise<RegistrationReport> | undefined;
  private status: WebMcpUiStatus;

  constructor(
    private readonly engine: GameEnginePort,
    options: WebMcpIntegrationOptions,
  ) {
    this.documentLike = options.document ?? browserDocument();
    this.windowLike = options.window ?? browserWindow();
    this.context = modelContextOf(this.documentLike);
    this.hasResonance = options.hasResonance ?? defaultHasResonance;
    this.onError = options.onError;
    this.staticTools = createWebMcpTools(engine);
    this.capabilityTools = createCapabilityTools(engine);
    this.status = this.createStatus(this.context ? "checking" : "unavailable");
  }

  preflight(): WebMcpPreflight {
    const available = this.context !== undefined;
    return {
      available,
      secureContext: this.windowLike?.isSecureContext,
      originIsolated: this.windowLike?.crossOriginIsolated,
      permissionsPolicy: "unknown",
      ...(available ? {} : { reason: "document.modelContext.registerTool is unavailable." }),
    };
  }

  async register(): Promise<RegistrationReport> {
    if (this.registrationPromise) return this.registrationPromise;
    this.registrationPromise = this.performRegistration();
    try {
      return await this.registrationPromise;
    } finally {
      this.registrationPromise = undefined;
    }
  }

  getStatus(): WebMcpUiStatus {
    return {
      ...this.status,
      registeredTools: [...this.status.registeredTools],
      failures: this.status.failures.map((failure) => ({ ...failure })),
    };
  }

  subscribeStatus(listener: WebMcpStatusListener): () => void {
    if (this.disposed) return () => undefined;
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.unsubscribe?.();
    } catch {
      // Engine teardown must not prevent the remaining cleanup steps.
    }
    this.unsubscribe = undefined;
    for (const controller of this.controllers.values()) {
      try {
        controller.abort();
      } catch {
        // An individual controller must not prevent other registrations from aborting.
      }
    }
    this.controllers.clear();
    this.pending.clear();
    this.registered.clear();
    this.statusListeners.clear();
  }

  private async performRegistration(): Promise<RegistrationReport> {
    const result = report();
    if (this.disposed) {
      result.failures.push({ name: "*", error: new Error("WebMCP integration is disposed.") });
      return result;
    }
    if (!this.context) {
      result.failures.push({
        name: "*",
        error: new Error("WebMCP is unavailable in this browser context."),
      });
      return result;
    }

    for (const tool of this.staticTools) await this.registerOne(tool, result);
    this.ensureSubscription();
    await this.syncCapabilities(result);
    this.publishStatus(this.statusFailures.size > 0 ? "attention" : "ready");
    return result;
  }

  private ensureSubscription(): void {
    if (this.unsubscribe || !this.engine.subscribe || this.disposed) return;
    const cleanup = this.engine.subscribe(() => {
      void this.syncCapabilities(report());
    });
    if (typeof cleanup === "function") this.unsubscribe = cleanup;
  }

  private async syncCapabilities(result: RegistrationReport): Promise<void> {
    if (!this.context || this.disposed) return;
    const enabled = this.hasResonance(this.engine.getSnapshot());
    if (!enabled) return;
    const needsRegistration = this.capabilityTools.some((tool) => !this.registered.has(tool.name));
    if (needsRegistration) this.publishStatus("checking");
    for (const tool of this.capabilityTools) await this.registerOne(tool, result);
    this.publishStatus(this.statusFailures.size > 0 ? "attention" : "ready");
  }

  private async registerOne(tool: WebMcpToolDefinition, result: RegistrationReport): Promise<void> {
    if (this.disposed || !this.context) return;
    if (this.registered.has(tool.name)) {
      result.alreadyRegistered.push(tool.name);
      return;
    }
    const pending = this.pending.get(tool.name);
    if (pending) {
      const status = await pending;
      if (status === "registered") result.alreadyRegistered.push(tool.name);
      return;
    }

    const controller = new AbortController();
    this.controllers.set(tool.name, controller);
    const registration = Promise.resolve()
      .then(() => this.context?.registerTool(tool, { signal: controller.signal }))
      .then(() => {
        if (!this.disposed && !controller.signal.aborted) {
          this.registered.add(tool.name);
          this.statusFailures.delete(tool.name);
        }
        return "registered" as const;
      })
      .catch((error: unknown) => {
        if (isDuplicate(error)) return "duplicate" as const;
        if (!controller.signal.aborted && !this.disposed) {
          const item = { name: tool.name, error };
          result.failures.push(item);
          this.statusFailures.set(tool.name, sanitizeFailure(item));
          this.onError?.(item);
        }
        return "failed" as const;
      });
    this.pending.set(tool.name, registration);
    const status = await registration;
    this.pending.delete(tool.name);

    const active = !this.disposed && !controller.signal.aborted;
    if (status === "registered" && active) result.registered.push(tool.name);
    if (status === "duplicate" && active) {
      // Another integration owns the registration, but the tool is still usable.
      this.registered.add(tool.name);
      this.statusFailures.delete(tool.name);
      result.duplicates.push(tool.name);
    }
    if (status === "failed" && active && !result.failures.some((item) => item.name === tool.name)) {
      result.failures.push({ name: tool.name, error: new Error("Tool registration failed.") });
    }
  }

  private createStatus(phase: WebMcpUiStatusPhase): WebMcpUiStatus {
    return {
      phase,
      available: this.context !== undefined,
      secureContext: this.windowLike?.isSecureContext,
      originIsolated: this.windowLike?.crossOriginIsolated,
      registeredTools: [],
      failures: [],
    };
  }

  private publishStatus(phase: WebMcpUiStatusPhase): void {
    if (this.disposed) return;
    const next: WebMcpUiStatus = {
      phase,
      available: this.context !== undefined,
      secureContext: this.windowLike?.isSecureContext,
      originIsolated: this.windowLike?.crossOriginIsolated,
      registeredTools: [...this.registered],
      failures: [...this.statusFailures.values()],
    };
    const previous = this.status;
    const changed =
      previous.phase !== next.phase ||
      previous.available !== next.available ||
      previous.secureContext !== next.secureContext ||
      previous.originIsolated !== next.originIsolated ||
      !sameArray(previous.registeredTools, next.registeredTools) ||
      !sameFailures(previous.failures, next.failures);
    this.status = next;
    if (!changed) return;
    for (const listener of this.statusListeners) {
      try {
        listener(this.getStatus());
      } catch {
        // A presentation listener must not interfere with engine registration.
      }
    }
  }
}

function sanitizeFailure(failure: RegistrationFailure): WebMcpUiFailure {
  const code = failureCode(failure.error);
  const safeCode = SAFE_BROWSER_FAILURE_CODES.has(code) ? code : undefined;
  return {
    name: failure.name,
    message: "Tool registration failed.",
    ...(safeCode ? { code: safeCode } : {}),
  };
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameFailures(
  left: readonly WebMcpUiFailure[],
  right: readonly WebMcpUiFailure[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (failure, index) =>
        failure.name === right[index]?.name &&
        failure.message === right[index]?.message &&
        failure.code === right[index]?.code,
    )
  );
}

export function createWebMcpIntegration(
  engine: GameEnginePort,
  options: WebMcpIntegrationOptions = {},
): WebMcpIntegration {
  return new WebMcpIntegrationImpl(engine, options);
}

/**
 * App-facing entrypoint. Registration starts immediately while cleanup remains
 * synchronous so a React effect can return `registration.dispose` directly.
 */
export function registerWebMcp(
  engine: GameEnginePort,
  options: WebMcpIntegrationOptions = {},
): WebMcpRegistration {
  const integration = createWebMcpIntegration(engine, options);
  return Object.assign(integration, { ready: integration.register() });
}

export { CAPABILITY_TOOL_NAMES, STATIC_TOOL_NAMES };
