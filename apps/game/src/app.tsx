import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ACTION_LABELS,
  type ActivityEvent,
  CHARACTERS,
  type GameAction,
  type GameSnapshot,
  getLandmark,
  getObjectiveState,
  INITIAL_SNAPSHOT,
  type LandmarkId,
  resolveLandmarkAction,
  ZONE_CONTENT,
} from "./app-model";
import { useAppRoute } from "./app-route";
import type { AppRuntime } from "./app-runtime";
import { LandingPage } from "./landing-page";
import { WorldScene } from "./rendering/world-scene";
import type { WebMcpRegistration, WebMcpUiStatus } from "./webmcp";

type GameAppProps = {
  runtime: AppRuntime;
  webMcp: WebMcpRegistration;
  onReturnToLanding?: () => void;
  openCoachOnMount?: boolean;
  onCoachRequestConsumed?: () => void;
};

const noop = () => undefined;

const GUIDE_DISMISSED_KEY = "wildgent.guide.dismissed.v1";

const COACH_STEPS = [
  {
    title: "Move and select",
    body: "Use WASD or the arrow keys to walk. Click a landmark tab or the world to select a place and let the field lens guide you there.",
    cue: "Ember marks your path",
    cueClass: "coach-cue-human",
  },
  {
    title: "Interact at the edge of the world",
    body: "When you are close enough, the gold action prompt comes alive. Press E, Space, or the prompt itself to change the world.",
    cue: "Gold means your next objective",
    cueClass: "coach-cue-objective",
  },
  {
    title: "Cooperate with Echo",
    body: "Echo can act through the shared field once a signal is found. You keep the discoveries that only a human can make; Echo carries the thread forward.",
    cue: "Cyan means Echo and shared signal",
    cueClass: "coach-cue-echo",
  },
] as const;

type EchoLinkState = "checking" | "ready" | "unavailable" | "attention";

type EchoLinkView = {
  state: EchoLinkState;
  label: string;
  detail: string;
  registeredTools: string[];
  supported: boolean;
};

const STATIC_ECHO_TOOLS = ["get_game_state", "look_around", "inspect"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const stringValue = (...values: unknown[]): string | undefined =>
  values.find((value): value is string => typeof value === "string" && value.trim().length > 0);

const stringList = (...values: unknown[]): string[] => {
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    const items = value.filter(
      (item): item is string => typeof item === "string" && item.length > 0,
    );
    if (items.length > 0) return [...new Set(items)];
  }
  return [];
};

const guideWasDismissed = () => {
  try {
    return window.localStorage.getItem(GUIDE_DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
};

const rememberGuideDismissal = () => {
  try {
    window.localStorage.setItem(GUIDE_DISMISSED_KEY, "true");
  } catch {
    // Private browsing and embedded contexts can deny storage. The coach still closes for this run.
  }
};

const normalizeEchoLinkStatus = (status: WebMcpUiStatus | undefined): EchoLinkView => {
  const raw = (isRecord(status) ? status : {}) as Record<string, unknown>;
  const rawState = stringValue(raw.state, raw.status, raw.availability, raw.phase)?.toLowerCase();
  const state: EchoLinkState =
    rawState === "ready" || rawState === "connected" || rawState === "available"
      ? "ready"
      : rawState === "attention" || rawState === "degraded" || rawState === "error"
        ? "attention"
        : rawState === "checking" || rawState === "pending" || rawState === "registering"
          ? "checking"
          : "unavailable";
  const supported =
    raw.supported === true ||
    raw.available === true ||
    (isRecord(raw.preflight) && raw.preflight.available === true) ||
    state === "ready";
  const registeredTools = stringList(
    raw.registeredTools,
    raw.registeredCapabilities,
    raw.tools,
    raw.capabilities,
    raw.registered,
  );
  const fallbackTools = state === "ready" ? STATIC_ECHO_TOOLS : [];
  const label =
    stringValue(raw.label, raw.title) ??
    (state === "ready"
      ? "Ready"
      : state === "checking"
        ? "Checking"
        : state === "attention"
          ? "Needs attention"
          : "Unavailable");
  const detail =
    stringValue(raw.detail, raw.message, raw.reason, raw.error) ??
    (state === "ready"
      ? "Echo can discover and act through the shared field."
      : state === "checking"
        ? "Checking the browser connection…"
        : state === "attention"
          ? "Echo Link needs a quick look before it can act."
          : "This browser does not expose Echo Link. Manual play is still available.");
  return {
    state,
    label,
    detail,
    registeredTools: registeredTools.length > 0 ? registeredTools : fallbackTools,
    supported,
  };
};

const formatTime = (timestamp: number) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const EVENT_TITLES: Record<string, string> = {
  start_journey: "The expedition begins",
  judge_demo: "Echo joins at the relay",
  move_step: "You move through the wilds",
  move_to_position: "The party advances",
  travel_to: "A new path opens",
  ignite: "Cindra answers",
  break: "Grum clears the way",
  interface: "Voltyn interfaces",
  discover_maintenance_path: "A hidden route is found",
  set_directive: "Your directive is heard",
  start_battle: "The guardian awakens",
  battle_action: "The clash continues",
  claim_core: "The Ancient Core remembers",
};

const eventTitle = (event: ActivityEvent) =>
  EVENT_TITLES[event.commandType ?? ""] ??
  (event.kind === "echo"
    ? "Echo acts in the world"
    : event.kind === "discovery"
      ? "A discovery becomes shared"
      : event.kind === "battle"
        ? "The guardian responds"
        : event.kind === "human"
          ? "Your action changes the path"
          : "The living signal shifts");

const useRuntimeSnapshot = (runtime: AppRuntime) => {
  const [snapshot, setSnapshot] = useState<GameSnapshot>(() => runtime.getSnapshot());

  useEffect(() => runtime.subscribe(setSnapshot), [runtime]);

  return snapshot;
};

export function WildGentApp({ runtime, webMcp }: GameAppProps) {
  const route = useAppRoute();
  const snapshot = useRuntimeSnapshot(runtime);
  const deferRouteFocusRef = useRef(false);
  deferRouteFocusRef.current =
    route.path === "/play" && route.intent === "start" && !guideWasDismissed();

  useEffect(() => {
    document.title =
      route.path === "/play" ? "WildGent — The Living Signal" : "WildGent — Find the signal";
  }, [route.path]);

  useEffect(() => {
    if (deferRouteFocusRef.current) return;
    const focusFrame = window.requestAnimationFrame(() => {
      const selector =
        route.path === "/play" ? '[data-route-focus="game"]' : '[data-route-focus="landing"]';
      document.querySelector<HTMLElement>(selector)?.focus();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [route.path]);

  useEffect(() => {
    if (route.path !== "/play" || snapshot.phase !== "preflight") return;
    route.navigate("/", { replace: true, intent: "redirect" });
  }, [route, snapshot.phase]);

  if (route.path === "/play" && snapshot.phase !== "preflight") {
    return (
      <GameApp
        runtime={runtime}
        webMcp={webMcp}
        onReturnToLanding={() => route.navigate("/")}
        openCoachOnMount={route.intent === "start"}
        onCoachRequestConsumed={route.consumeStartRequest}
      />
    );
  }

  return (
    <LandingPage
      snapshot={snapshot}
      runtime={runtime}
      onNavigate={(path, options) => route.navigate(path, options)}
    />
  );
}

export function GameApp({
  runtime,
  webMcp,
  onReturnToLanding = noop,
  openCoachOnMount = false,
  onCoachRequestConsumed = noop,
}: GameAppProps) {
  const [snapshot, setSnapshot] = useState<GameSnapshot>(() => runtime.getSnapshot());
  const [busy, setBusy] = useState(runtime.coordinator.isBusy);
  const [selectedLandmark, setSelectedLandmark] = useState<LandmarkId | null>(
    snapshot.selectedLandmark,
  );
  const [error, setError] = useState<string | null>(null);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [visibleActivityId, setVisibleActivityId] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideJudgeOpen, setGuideJudgeOpen] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);
  const [coachStep, setCoachStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const [webMcpStatus, setWebMcpStatus] = useState<WebMcpUiStatus>(() => webMcp.getStatus());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<WorldScene | null>(null);
  const snapshotRef = useRef(snapshot);
  const pausedRef = useRef(paused);
  const guideButtonRef = useRef<HTMLButtonElement>(null);
  const guideCloseRef = useRef<HTMLButtonElement>(null);
  const guideRestoreRef = useRef<HTMLElement | null>(null);
  const coachDialogRef = useRef<HTMLDivElement>(null);
  const coachRestoreRef = useRef<HTMLElement | null>(null);
  const coachPausedBeforeRef = useRef<boolean | null>(null);
  const echoLink = useMemo(() => normalizeEchoLinkStatus(webMcpStatus), [webMcpStatus]);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    pausedRef.current = paused;
    runtime.setPaused(paused);
    return () => runtime.setPaused(false);
  }, [paused, runtime]);

  useEffect(() => {
    const unsubscribeSnapshot = runtime.subscribe((nextSnapshot) => {
      setSnapshot(nextSnapshot);
      if (nextSnapshot.selectedLandmark) setSelectedLandmark(nextSnapshot.selectedLandmark);
    });
    const unsubscribeBusy = runtime.subscribeBusy(setBusy);
    return () => {
      unsubscribeSnapshot();
      unsubscribeBusy();
    };
  }, [runtime]);

  useEffect(() => {
    setWebMcpStatus(webMcp.getStatus());
    return webMcp.subscribeStatus((nextStatus) => setWebMcpStatus(nextStatus));
  }, [webMcp]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let scene: WorldScene;
    try {
      scene = new WorldScene(canvas, {
        onLandmarkClick: (landmark) => {
          if (pausedRef.current) return;
          setSelectedLandmark(landmark);
          sceneRef.current?.setSelectedLandmark(landmark);
          const content = getLandmark(landmark);
          if (content?.zone === snapshotRef.current.zone)
            void runtime.dispatch({ type: "MOVE_TO", position: content.position, landmark });
        },
        onCellClick: (position, zone) => {
          if (pausedRef.current) return;
          if (zone !== snapshotRef.current.zone || snapshotRef.current.phase !== "journey") return;
          void runtime.dispatch({ type: "MOVE_TO", position });
        },
        onHumanSignalClick: () => {
          if (pausedRef.current) return;
          const current = snapshotRef.current;
          if (
            current.zone === "ruins" &&
            current.flags.sigilRead &&
            !current.flags.vinesDiscovered
          ) {
            void runtime.dispatch({ type: "DISCOVER_SIGNAL" });
          }
        },
      });
      sceneRef.current = scene;
      runtime.setPresentationSync((nextSnapshot) => scene.setSnapshot(nextSnapshot));
      scene.setSnapshot(snapshotRef.current);
      const resizeObserver = new ResizeObserver(() => {
        scene.resize(canvas.clientWidth, canvas.clientHeight);
      });
      resizeObserver.observe(canvas);
      return () => {
        resizeObserver.disconnect();
        runtime.cancelQueuedSteps();
        runtime.setPresentationSync(() => undefined);
        scene.dispose(canvas);
        sceneRef.current = null;
      };
    } catch (sceneCreationError) {
      setSceneError(
        sceneCreationError instanceof Error
          ? sceneCreationError.message
          : "The field lens could not open.",
      );
    }
  }, [runtime]); // Scene callbacks read the ref; presentation sync happens below.

  useEffect(() => {
    return () => {
      runtime.cancelQueuedSteps();
      runtime.setPaused(false);
    };
  }, [runtime]);

  useEffect(() => {
    sceneRef.current?.setSnapshot(snapshot, selectedLandmark);
  }, [selectedLandmark, snapshot]);

  useEffect(() => {
    sceneRef.current?.setSelectedLandmark(selectedLandmark);
  }, [selectedLandmark]);

  useEffect(() => {
    const latest = snapshot.activity.at(-1);
    if (!latest) return;
    setVisibleActivityId(latest.id);
    const timeout = window.setTimeout(() => setVisibleActivityId(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [snapshot.activity]);

  const dispatch = useCallback(
    async (action: GameAction) => {
      setError(null);
      const result = await runtime.dispatch(action);
      if (!result.ok) {
        setError(
          result.code === "BUSY"
            ? "The field lens is still resolving the last move."
            : "The field kit could not complete that action.",
        );
        return false;
      }
      if (
        typeof result.value === "object" &&
        result.value !== null &&
        "ok" in result.value &&
        result.value.ok === false
      ) {
        setError(
          "message" in result.value && typeof result.value.message === "string"
            ? result.value.message
            : "That action is not available yet.",
        );
        return false;
      }
      setSnapshot(result.snapshot);
      return true;
    },
    [runtime],
  );

  const activeLandmark = useMemo(() => {
    const selected = selectedLandmark ? getLandmark(selectedLandmark) : undefined;
    if (selected && selected.zone === snapshot.zone) return selected;
    const next = ZONE_CONTENT[snapshot.zone].landmarks.find(
      (landmark) => landmark.available(snapshot) && !landmark.complete(snapshot),
    );
    return next ?? ZONE_CONTENT[snapshot.zone].landmarks[0];
  }, [selectedLandmark, snapshot]);

  const zoneContent = ZONE_CONTENT[snapshot.zone];
  const selectedContent = activeLandmark ? getLandmark(activeLandmark.id) : undefined;
  const actionResolution = selectedContent
    ? resolveLandmarkAction(selectedContent, snapshot)
    : null;
  const canInteract = actionResolution?.state === "ready" && !busy;

  const handlePrimaryAction = useCallback(() => {
    if (
      snapshot.phase === "preflight" ||
      snapshot.phase === "battle" ||
      snapshot.phase === "complete"
    )
      return;
    if (snapshot.zone === "core" && snapshot.flags.guardianDefeated) {
      if (!canInteract) return;
      void dispatch({ type: "ENTER_CORE" });
      return;
    }
    if (selectedContent?.id === "ruins-vines" && !snapshot.flags.vinesDiscovered && canInteract) {
      void dispatch({ type: "DISCOVER_SIGNAL" });
      return;
    }
    if (selectedContent && canInteract)
      void dispatch({ type: "INTERACT", landmark: selectedContent.id });
  }, [canInteract, dispatch, selectedContent, snapshot]);

  const handleTravelToRuins = () => {
    if (
      snapshot.phase === "journey" &&
      snapshot.zone === "camp" &&
      snapshot.flags.resonanceCalibrated
    )
      void dispatch({ type: "TRAVEL_TO", zone: "ruins" });
  };

  const openGuide = useCallback(() => {
    const active = document.activeElement;
    guideRestoreRef.current =
      active instanceof HTMLElement &&
      active !== document.body &&
      active !== document.documentElement
        ? active
        : null;
    setGuideOpen(true);
  }, []);

  const closeGuide = useCallback(() => setGuideOpen(false), []);

  const openCoach = useCallback(() => {
    const active = document.activeElement;
    coachRestoreRef.current =
      active instanceof HTMLElement &&
      active !== document.body &&
      active !== document.documentElement
        ? active
        : null;
    setCoachStep(0);
    setGuideOpen(false);
    setCoachOpen(true);
  }, []);

  useEffect(() => {
    if (!openCoachOnMount) return;
    onCoachRequestConsumed();
    if (!guideWasDismissed()) openCoach();
  }, [onCoachRequestConsumed, openCoach, openCoachOnMount]);

  const closeCoach = useCallback(() => {
    rememberGuideDismissal();
    setCoachOpen(false);
    window.setTimeout(() => {
      const restore = coachRestoreRef.current;
      if (restore?.isConnected) {
        restore.focus();
        return;
      }
      (
        guideButtonRef.current ??
        document.querySelector<HTMLButtonElement>('[data-testid="open-field-guide"]')
      )?.focus();
    }, 0);
  }, []);

  useEffect(() => {
    if (!guideOpen) return;
    const focusFrame = window.requestAnimationFrame(() => guideCloseRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      const restore = guideRestoreRef.current;
      window.setTimeout(() => {
        if (restore?.isConnected) {
          restore.focus();
          return;
        }
        (
          guideButtonRef.current ??
          document.querySelector<HTMLButtonElement>('[data-testid="open-field-guide"]')
        )?.focus();
      }, 0);
    };
  }, [guideOpen]);

  useEffect(() => {
    if (!guideOpen || coachOpen) return;
    const handleGuideKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeGuide();
    };
    window.addEventListener("keydown", handleGuideKeyDown);
    return () => window.removeEventListener("keydown", handleGuideKeyDown);
  }, [coachOpen, closeGuide, guideOpen]);

  useEffect(() => {
    if (!coachOpen) return;
    coachPausedBeforeRef.current = pausedRef.current;
    setPaused(true);
    const focusFrame = window.requestAnimationFrame(() => {
      coachDialogRef.current?.querySelector<HTMLElement>("[data-coach-focus]")?.focus();
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      const previousPaused = coachPausedBeforeRef.current;
      if (previousPaused !== null) setPaused(previousPaused);
      const restore = coachRestoreRef.current;
      window.setTimeout(() => {
        if (restore?.isConnected) {
          restore.focus();
          return;
        }
        const target =
          guideButtonRef.current ??
          document.querySelector<HTMLButtonElement>('[data-testid="open-field-guide"]');
        target?.focus();
      }, 0);
    };
  }, [coachOpen]);

  useEffect(() => {
    if (!coachOpen) return;
    const handleCoachKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCoach();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = coachDialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable.at(0);
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleCoachKeyDown);
    return () => document.removeEventListener("keydown", handleCoachKeyDown);
  }, [coachOpen, closeCoach]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (coachOpen) return;
      if (event.key === "`") {
        event.preventDefault();
        if (guideOpen) closeGuide();
        else openGuide();
        return;
      }
      if (
        snapshot.phase !== "journey" ||
        paused ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      )
        return;
      const key = event.key.toLowerCase();
      const direction: Record<string, "north" | "south" | "east" | "west"> = {
        arrowup: "north",
        w: "north",
        arrowdown: "south",
        s: "south",
        arrowleft: "west",
        a: "west",
        arrowright: "east",
        d: "east",
      };
      const move = direction[key];
      if (move) {
        event.preventDefault();
        void runtime.enqueueHumanStep(move);
        return;
      }
      if (key === "e" || event.code === "Space") {
        event.preventDefault();
        handlePrimaryAction();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeGuide, coachOpen, guideOpen, handlePrimaryAction, openGuide, paused, runtime, snapshot]);

  const objective = getObjectiveState(snapshot);
  const latestActivity = snapshot.activity.at(-1);
  const party = snapshot.flags.resonanceCalibrated
    ? (["cindra", "grum", "voltyn"] as const)
    : (["cindra", "grum"] as const);

  return (
    <main className="game-shell" data-testid="game-shell" data-route-focus="game" tabIndex={-1}>
      <div className="game-world" role="img" aria-label="WildGent expedition world">
        <canvas
          ref={canvasRef}
          className="world-canvas"
          aria-label={`${zoneContent.title} low-poly expedition world`}
        />
        {sceneError ? (
          <div className="scene-notice" role="status">
            Field lens preview unavailable — the journey controls remain active.
          </div>
        ) : null}
      </div>

      <div className="hud-layer">
        <span className="sr-only" data-testid="grid-position">
          {String(snapshot.position.x).padStart(2, "0")} ·{" "}
          {String(snapshot.position.y).padStart(2, "0")}
        </span>
        <header className="hud-topbar">
          <div className="hud-brand">
            <span className="brand-mark" aria-hidden="true">
              W
            </span>
            <span className="hud-brand-name">WildGent</span>
            <span className="hud-zone-name">{zoneContent.title}</span>
          </div>
          <div className="hud-top-actions">
            <a
              className="return-button"
              href="/"
              onClick={(event) => {
                if (
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                event.preventDefault();
                onReturnToLanding();
              }}
              data-testid="return-to-landing"
            >
              <span aria-hidden="true">←</span> Landing
            </a>
            <span className="hud-sync-state">{busy ? "syncing" : "ready"}</span>
            <button
              className={`echo-link-status echo-link-${echoLink.state}`}
              type="button"
              onClick={openGuide}
              aria-label={`Echo Link: ${echoLink.label}. Open field guide for details.`}
              data-testid="echo-link-status"
            >
              <span className="echo-link-pip" aria-hidden="true" />
              <span className="echo-link-copy">
                <small>Echo Link</small>
                <strong>{echoLink.label}</strong>
              </span>
            </button>
            <button
              className={`directive-button ${snapshot.directives.avoidBattles ? "is-active" : ""}`}
              type="button"
              aria-pressed={snapshot.directives.avoidBattles}
              onClick={() =>
                void dispatch({
                  type: "SET_DIRECTIVE",
                  directive: "avoid-battles",
                  active: !snapshot.directives.avoidBattles,
                })
              }
              disabled={busy || paused}
              data-testid="avoid-battles"
            >
              <span className="directive-glyph" aria-hidden="true" />
              {snapshot.directives.avoidBattles ? "Avoid battles" : "Battles allowed"}
            </button>
            <button
              className={`pause-button ${paused ? "is-active" : ""}`}
              type="button"
              aria-pressed={paused}
              aria-label={paused ? "Resume expedition" : "Pause expedition"}
              onClick={() => setPaused((current) => !current)}
              data-testid="pause-expedition"
            >
              <span aria-hidden="true">{paused ? "▶" : "Ⅱ"}</span>
            </button>
            <button
              className="menu-button"
              type="button"
              ref={guideButtonRef}
              title="Open field guide"
              aria-expanded={guideOpen}
              aria-controls="field-guide-drawer"
              onClick={guideOpen ? closeGuide : openGuide}
              data-testid="open-field-guide"
            >
              Menu
            </button>
          </div>
        </header>

        <section className="objective-hud" aria-labelledby="current-objective">
          <span className="hud-eyebrow">Current objective</span>
          <h1 className="zone-title">{zoneContent.title}</h1>
          <h2 id="current-objective">{objective.title}</h2>
          <p>{objective.detail}</p>
          {snapshot.zone === "camp" && snapshot.flags.resonanceCalibrated ? (
            <button
              className="travel-button"
              type="button"
              onClick={handleTravelToRuins}
              disabled={busy || paused}
            >
              Ruins / guardian
            </button>
          ) : null}
        </section>

        {latestActivity && latestActivity.id === visibleActivityId ? (
          <div
            className={`world-toast toast-${latestActivity.kind}`}
            role="status"
            aria-live="polite"
          >
            <span className="toast-mark" aria-hidden="true" />
            <span>
              <strong>{eventTitle(latestActivity)}</strong>
              <small>{latestActivity.detail}</small>
            </span>
          </div>
        ) : null}

        <section className="party-hud" aria-label="Expedition party and Echo capabilities">
          <div className="party-cards">
            {party.map((characterId) => {
              const character = CHARACTERS[characterId];
              return (
                <div className={`party-card party-${characterId}`} key={characterId}>
                  <span className="party-avatar" aria-hidden="true">
                    {character.name[0]}
                  </span>
                  <span className="party-card-copy">
                    <strong>{character.name}</strong>
                    <small>{character.role}</small>
                  </span>
                  <span className="party-health" aria-hidden="true" />
                </div>
              );
            })}
          </div>
          <fieldset className="capability-row">
            <legend className="sr-only">Echo capabilities</legend>
            <span className="capability-label">Echo</span>
            <span className="echo-status">
              {snapshot.echo.signalFound ? "Human lens open" : "Echo listening"}
            </span>
            <span className="capability is-ready">ignite</span>
            <span className="capability is-ready">break</span>
            <span
              className={`capability ${snapshot.flags.resonanceCalibrated ? "is-new" : "is-locked"}`}
            >
              interface{snapshot.flags.resonanceCalibrated ? " · new" : " · locked"}
            </span>
          </fieldset>
        </section>

        <fieldset className="landmark-strip">
          <legend className="sr-only">Visible landmarks</legend>
          {zoneContent.landmarks.map((landmark) => {
            const complete = landmark.complete(snapshot);
            const locked = !landmark.available(snapshot);
            return (
              <button
                key={landmark.id}
                className={`landmark-tab ${selectedLandmark === landmark.id ? "is-selected" : ""} ${complete ? "is-complete" : ""}`}
                type="button"
                onClick={() => {
                  setSelectedLandmark(landmark.id);
                  sceneRef.current?.setSelectedLandmark(landmark.id);
                  void runtime.dispatch({
                    type: "MOVE_TO",
                    position: landmark.position,
                    landmark: landmark.id,
                  });
                }}
                disabled={locked || busy || paused}
                data-testid={`landmark-${landmark.id}`}
              >
                <span className="landmark-tab-mark" aria-hidden="true">
                  {complete ? "✓" : "·"}
                </span>
                {landmark.id === "relay-station" ? "Relay Resonance" : landmark.shortLabel}
                {locked ? <span className="sr-only"> locked</span> : null}
              </button>
            );
          })}
        </fieldset>

        {snapshot.phase === "battle" && snapshot.battle ? (
          <BattlePanel
            battle={snapshot.battle}
            busy={busy || paused}
            onMove={(move) => void dispatch({ type: "ATTACK", move })}
          />
        ) : snapshot.phase === "complete" ? (
          <section className="complete-hud" data-testid="complete-panel">
            <span className="complete-seal" aria-hidden="true">
              W
            </span>
            <h2>The forest remembers.</h2>
            <p>
              You carried the cyan thread into the core. Echo can follow the note now; the discovery
              remains yours.
            </p>
            <button
              className="hud-action-button"
              type="button"
              onClick={() => void runtime.reset({ mode: "journey" })}
            >
              Walk it again
            </button>
          </section>
        ) : (
          <section className="context-prompt" aria-label="Contextual action">
            <button
              className="context-action"
              type="button"
              onClick={handlePrimaryAction}
              disabled={!canInteract || paused}
              data-testid="landmark-action"
            >
              <kbd>E</kbd>
              <span>
                {actionResolution?.label ?? activeLandmark?.actionLabel ?? ACTION_LABELS.INTERACT}
              </span>
              <span className="action-state">
                {busy
                  ? "syncing"
                  : actionResolution?.state === "complete"
                    ? "complete"
                    : (actionResolution?.state ?? "locked")}
              </span>
              <small>
                {actionResolution?.state === "approach" ? actionResolution.hint : "or press Space"}
              </small>
            </button>
          </section>
        )}

        <button
          className={`log-handle ${logOpen ? "is-open" : ""}`}
          type="button"
          onClick={() => setLogOpen((current) => !current)}
          aria-expanded={logOpen}
          aria-controls="adventure-log"
          data-testid="toggle-adventure-log"
        >
          <span className="log-handle-mark" aria-hidden="true" />
          <span>Adventure log</span>
        </button>
        {logOpen ? (
          <aside className="adventure-log" id="adventure-log" aria-label="Adventure log">
            <div className="log-heading">
              <h2>Adventure log</h2>
              <button
                type="button"
                onClick={() => setLogOpen(false)}
                aria-label="Collapse adventure log"
              >
                Close
              </button>
            </div>
            <div className="activity-list" aria-live="polite">
              {snapshot.activity
                .slice(-6)
                .reverse()
                .map((event) => (
                  <article className={`activity-row activity-${event.kind}`} key={event.id}>
                    <span className="activity-marker" aria-hidden="true" />
                    <span>
                      <strong>{eventTitle(event)}</strong>
                      <small>{event.detail}</small>
                    </span>
                  </article>
                ))}
            </div>
          </aside>
        ) : null}

        {error ? (
          <div className="error-note" role="alert">
            <span aria-hidden="true">!</span>
            {error}
          </div>
        ) : null}
        {paused && !coachOpen ? (
          <div className="paused-overlay" role="status">
            <strong>Expedition paused</strong>
            <span>Press the pause control to return to the field.</span>
            <button type="button" onClick={() => setPaused(false)}>
              Resume expedition
            </button>
          </div>
        ) : null}
        {guideOpen ? (
          <FieldGuideDrawer
            busy={busy}
            echoLink={echoLink}
            guideJudgeOpen={guideJudgeOpen}
            onClose={closeGuide}
            onJudgeToggle={() => setGuideJudgeOpen((current) => !current)}
            onReplayCoach={openCoach}
            paused={paused}
            snapshot={snapshot}
            closeButtonRef={guideCloseRef}
            runtime={runtime}
          />
        ) : null}
        {coachOpen ? (
          <FirstRunCoach
            dialogRef={coachDialogRef}
            onBack={() => setCoachStep((current) => Math.max(0, current - 1))}
            onFinish={closeCoach}
            onNext={() => setCoachStep((current) => Math.min(COACH_STEPS.length - 1, current + 1))}
            onSkip={closeCoach}
            step={coachStep}
          />
        ) : null}
      </div>
      <section
        className="desktop-required"
        data-testid="desktop-required"
        aria-labelledby="desktop-required-title"
      >
        <div className="desktop-required-mark" aria-hidden="true">
          W
        </div>
        <h1 id="desktop-required-title">The field needs a wider view.</h1>
        <p>
          WildGent is built for keyboard-and-mouse play on a desktop screen. Reopen this expedition
          at 1024px or wider to enter the living world.
        </p>
      </section>
    </main>
  );
}

function BattlePanel({
  battle,
  busy,
  onMove,
}: {
  battle: NonNullable<GameSnapshot["battle"]>;
  busy: boolean;
  onMove: (move: "resonance" | "guard" | "pulse" | "environment") => void;
}) {
  const healthWidth = `${Math.max(0, Math.min(100, (battle.enemyHp / battle.enemyMaxHp) * 100))}%`;
  return (
    <section className="battle-hud" data-testid="battle-panel">
      <div className="rail-label">
        <span>Guardian encounter</span>
        <span>
          {battle.enemyHp} / {battle.enemyMaxHp} HP
        </span>
      </div>
      <div className="battle-heading">
        <div className="guardian-token" aria-hidden="true">
          G
        </div>
        <div>
          <h2>{battle.enemyName}</h2>
          <p>{battle.lastMove}</p>
        </div>
      </div>
      <div
        className="health-track"
        role="progressbar"
        aria-label={`Guardian health ${battle.enemyHp} of ${battle.enemyMaxHp}`}
        aria-valuemin={0}
        aria-valuemax={battle.enemyMaxHp}
        aria-valuenow={battle.enemyHp}
      >
        <span style={{ width: healthWidth }} />
      </div>
      <div className="battle-actions">
        <button
          type="button"
          className="battle-move"
          onClick={() => onMove("resonance")}
          disabled={busy}
        >
          <strong>Resonance</strong>
          <small>break the rhythm</small>
        </button>
        <button
          type="button"
          className="battle-move"
          onClick={() => onMove("guard")}
          disabled={busy}
        >
          <strong>Guard</strong>
          <small>hold your ground</small>
        </button>
        <button
          type="button"
          className="battle-move"
          onClick={() => onMove("pulse")}
          disabled={busy}
        >
          <strong>Pulse</strong>
          <small>send it back</small>
        </button>
        <button
          type="button"
          className="battle-move"
          onClick={() => onMove("environment")}
          disabled={busy}
        >
          <strong>Conduit</strong>
          <small>use the environment</small>
        </button>
      </div>
      <p className="party-vitality">
        Party vitality {battle.playerHp} / {battle.playerMaxHp}
      </p>
    </section>
  );
}

type FieldGuideDrawerProps = {
  busy: boolean;
  echoLink: EchoLinkView;
  guideJudgeOpen: boolean;
  onClose: () => void;
  onJudgeToggle: () => void;
  onReplayCoach: () => void;
  paused: boolean;
  snapshot: GameSnapshot;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  runtime: AppRuntime;
};

function FieldGuideDrawer({
  busy,
  echoLink,
  guideJudgeOpen,
  onClose,
  onJudgeToggle,
  onReplayCoach,
  paused,
  snapshot,
  closeButtonRef,
  runtime,
}: FieldGuideDrawerProps) {
  const registeredTools = echoLink.registeredTools.length
    ? echoLink.registeredTools.join(" · ")
    : "No tools registered";

  return (
    <aside
      className="field-guide-drawer"
      id="field-guide-drawer"
      aria-label="WildGent field guide"
      aria-modal="false"
      data-testid="field-guide-drawer"
      role="dialog"
    >
      <div className="field-guide-heading">
        <div>
          <span className="field-guide-kicker">A note for the field</span>
          <h2>Field guide</h2>
        </div>
        <button
          ref={closeButtonRef}
          className="field-guide-close"
          type="button"
          onClick={onClose}
          aria-label="Close field guide"
        >
          Close
        </button>
      </div>

      <div className="field-guide-scroll">
        <details className="guide-section" open>
          <summary>
            <span>How to Play</span>
            <small>the essentials</small>
          </summary>
          <div className="guide-section-body">
            <p>
              Walk the living world, select what catches your eye, and follow the one bright thing
              the field asks of you.
            </p>
            <ul className="guide-list">
              <li>
                <strong>Move / select</strong>
                <span>
                  Use WASD or the arrow keys. Click the world or a landmark to choose a destination.
                </span>
              </li>
              <li>
                <strong>Interact</strong>
                <span>
                  When the gold prompt says you are ready, press E, Space, or the prompt itself.
                </span>
              </li>
              <li>
                <strong>Follow the objective</strong>
                <span>
                  The field keeps the next useful action close. The adventure log remembers what
                  changed.
                </span>
              </li>
            </ul>
            <button className="guide-replay" type="button" onClick={onReplayCoach}>
              Replay the field coach
            </button>
          </div>
        </details>

        <details className="guide-section" open>
          <summary>
            <span>Human + Echo</span>
            <small>two kinds of agency</small>
          </summary>
          <div className="guide-section-body">
            <p>
              WildGent is shared ground. You discover what only a human hand can find; Echo can
              reason over the visible field and carry an unlocked capability into the next moment.
            </p>
            <div className="guide-cues">
              <div className="guide-cue guide-cue-human">
                <span className="guide-cue-mark" aria-hidden="true" />
                <span>
                  <strong>Ember · human</strong>
                  <small>Your movement, choices, and discoveries.</small>
                </span>
              </div>
              <div className="guide-cue guide-cue-echo">
                <span className="guide-cue-mark" aria-hidden="true" />
                <span>
                  <strong>Cyan · Echo</strong>
                  <small>Shared signal and Echo capability activity.</small>
                </span>
              </div>
              <div className="guide-cue guide-cue-objective">
                <span className="guide-cue-mark" aria-hidden="true" />
                <span>
                  <strong>Gold · objective</strong>
                  <small>The next place, prompt, or story turn to notice.</small>
                </span>
              </div>
            </div>
          </div>
        </details>

        <details className="guide-section guide-echo-section" open>
          <summary>
            <span>Echo Link</span>
            <small>{echoLink.label}</small>
          </summary>
          <div className="guide-section-body">
            <div className={`guide-link-status guide-link-${echoLink.state}`} role="status">
              <span className="echo-link-pip" aria-hidden="true" />
              <div>
                <strong>{echoLink.label}</strong>
                <p>{echoLink.detail}</p>
              </div>
            </div>
            <p>
              Echo Link is optional infrastructure. If this browser does not support it, the human
              journey remains fully playable and no objective is blocked.
            </p>
            <details className="guide-judge-details" open={guideJudgeOpen} onToggle={onJudgeToggle}>
              <summary>Judge Demo details</summary>
              <div className="guide-judge-body">
                <p>
                  Supported boundary: Echo Link needs a secure HTTPS page in a compatible Chrome
                  build with the WebMCP origin trial and <code>document.modelContext</code> enabled.
                </p>
                <p>
                  Registered capability names: <code>{registeredTools}</code>
                </p>
                <p>Begin the relay verification with:</p>
                <ol>
                  <li>
                    Call <code>get_game_state</code>.
                  </li>
                  <li>
                    Call <code>look_around</code>.
                  </li>
                  <li>
                    Inspect the visible target <code>voltyn-relay</code>.
                  </li>
                  <li>
                    Call <code>break</code> on <code>voltyn-relay</code>.
                  </li>
                  <li>
                    Re-read state with <code>get_game_state</code>.
                  </li>
                </ol>
                <p>Then continue the complete Judge Demo:</p>
                <ol start={6}>
                  <li>
                    Enable the human-owned <strong>Avoid battles</strong> directive.
                  </li>
                  <li>
                    Ask Echo: “We need to reach the signal. Figure it out, but don&apos;t start any
                    battles.”
                  </li>
                  <li>
                    Let Echo clear the ruins, inspect the terminal, and use the newly unlocked
                    <code>interface</code> capability.
                  </li>
                  <li>
                    When Echo reports <code>HUMAN_DISCOVERY_REQUIRED</code>, manually investigate
                    the cyan signal in the vines.
                  </li>
                  <li>
                    Let Echo resume and open the ruin. At the guardian, verify that Avoid battles
                    blocks combat.
                  </li>
                  <li>
                    Clear Avoid battles with the human control, then finish the battle and Ancient
                    Core manually.
                  </li>
                </ol>
                <p className="guide-boundary-note">
                  Stop at human-required boundaries such as <code>HUMAN_DISCOVERY_REQUIRED</code>.
                  The discovery stays with the player.
                </p>
              </div>
            </details>
          </div>
        </details>

        <details className="guide-section guide-diagnostics">
          <summary>
            <span>Diagnostics</span>
            <small>for a closer look</small>
          </summary>
          <div className="guide-section-body">
            <dl className="guide-diagnostics-list">
              <div>
                <dt>phase</dt>
                <dd>{snapshot.phase}</dd>
              </div>
              <div>
                <dt>zone</dt>
                <dd>{snapshot.zone}</dd>
              </div>
              <div>
                <dt>position</dt>
                <dd>
                  {String(snapshot.position.x).padStart(2, "0")} ·{" "}
                  {String(snapshot.position.y).padStart(2, "0")}
                </dd>
              </div>
              <div>
                <dt>mutation lock</dt>
                <dd>{busy ? "busy" : paused ? "paused" : "open"}</dd>
              </div>
              <div>
                <dt>Echo Link</dt>
                <dd>{echoLink.state}</dd>
              </div>
              <div>
                <dt>registered tools</dt>
                <dd>{registeredTools}</dd>
              </div>
            </dl>
            <div className="guide-event-list">
              {snapshot.activity
                .slice(-4)
                .reverse()
                .map((event) => (
                  <div key={event.id}>
                    <strong>{event.commandType ?? "event"}</strong>
                    <span>
                      {event.accepted === false ? "refused" : "accepted"} ·{" "}
                      {formatTime(event.timestamp)}
                    </span>
                    <span>{event.detail}</span>
                  </div>
                ))}
            </div>
            <button
              className="debug-reset"
              type="button"
              onClick={() => void runtime.reset({ mode: "journey" })}
            >
              Reset expedition
            </button>
          </div>
        </details>
      </div>
    </aside>
  );
}

type FirstRunCoachProps = {
  dialogRef: RefObject<HTMLDivElement | null>;
  onBack: () => void;
  onFinish: () => void;
  onNext: () => void;
  onSkip: () => void;
  step: number;
};

function FirstRunCoach({ dialogRef, onBack, onFinish, onNext, onSkip, step }: FirstRunCoachProps) {
  const current = COACH_STEPS[step] ?? COACH_STEPS[0];
  const lastStep = step === COACH_STEPS.length - 1;

  return (
    <div className="coach-backdrop">
      <section
        ref={dialogRef}
        className="first-run-coach"
        role="dialog"
        aria-modal="true"
        aria-labelledby="coach-title"
        aria-describedby="coach-body"
        data-testid="first-run-coach"
      >
        <header className="coach-heading">
          <span className="coach-progress">
            Field coach <strong>{step + 1}</strong> / {COACH_STEPS.length}
          </span>
          <button className="coach-skip" type="button" onClick={onSkip} data-testid="coach-skip">
            Skip
          </button>
        </header>
        <div className="coach-signal" aria-hidden="true">
          <span className={`coach-signal-line ${current.cueClass}`} />
          <span className="coach-signal-node" />
        </div>
        <p className={`coach-cue-label ${current.cueClass}`}>{current.cue}</p>
        <h2 id="coach-title">{current.title}</h2>
        <p id="coach-body">{current.body}</p>
        <footer className="coach-actions">
          <button type="button" onClick={onBack} disabled={step === 0} data-testid="coach-back">
            Back
          </button>
          {lastStep ? (
            <button
              className="coach-primary"
              type="button"
              onClick={onFinish}
              data-coach-focus
              data-testid="coach-finish"
            >
              Finish
            </button>
          ) : (
            <button
              className="coach-primary"
              type="button"
              onClick={onNext}
              data-coach-focus
              data-testid="coach-next"
            >
              Next
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

export const createInitialSnapshotForPreview = () => INITIAL_SNAPSHOT;
