import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import type { AppRuntime } from "./app-runtime";
import { WorldScene } from "./rendering/world-scene";

type GameAppProps = {
  runtime: AppRuntime;
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

export function GameApp({ runtime }: GameAppProps) {
  const [snapshot, setSnapshot] = useState<GameSnapshot>(() => runtime.getSnapshot());
  const [busy, setBusy] = useState(runtime.coordinator.isBusy);
  const [selectedLandmark, setSelectedLandmark] = useState<LandmarkId | null>(
    snapshot.selectedLandmark,
  );
  const [error, setError] = useState<string | null>(null);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [visibleActivityId, setVisibleActivityId] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<WorldScene | null>(null);
  const snapshotRef = useRef(snapshot);
  const pausedRef = useRef(paused);
  const gameplayMounted = snapshot.phase !== "preflight";

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
    if (!gameplayMounted) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let scene: WorldScene;
    try {
      scene = new WorldScene(canvas, {
        onLandmarkClick: (landmark) => {
          if (pausedRef.current) return;
          setSelectedLandmark(landmark);
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
  }, [runtime, gameplayMounted]); // Scene callbacks read the ref; presentation sync happens below.

  useEffect(() => {
    sceneRef.current?.setSnapshot(snapshot);
  }, [snapshot]);

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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "`") {
        event.preventDefault();
        setDebugOpen((current) => !current);
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
  }, [runtime, snapshot, paused, handlePrimaryAction]);

  const startJourney = (mode: "journey" | "demo") => {
    void dispatch({ type: mode === "demo" ? "START_DEMO" : "START_JOURNEY" });
  };

  if (snapshot.phase === "preflight") {
    return (
      <main className="preflight" data-testid="preflight-screen">
        <div className="preflight-glow" aria-hidden="true" />
        <header className="preflight-header">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">
              W
            </span>
            <span>WildGent</span>
          </div>
          <span className="edition-stamp">FIELD KIT / 01</span>
        </header>
        <section className="preflight-content">
          <div className="preflight-copy">
            <p className="signal-kicker">
              <span className="signal-dot" aria-hidden="true" /> A living-world expedition
            </p>
            <h1>
              Find the signal
              <br />
              <em>before it fades.</em>
            </h1>
            <p className="preflight-dek">
              A short journey through a low-poly forest, shared by a human hand and a listening
              Echo.
            </p>
            <div className="preflight-actions">
              <button
                className="button button-primary"
                type="button"
                onClick={() => startJourney("journey")}
                data-testid="start-journey"
              >
                Begin journey <span aria-hidden="true">↗</span>
              </button>
              <button
                className="button button-quiet"
                type="button"
                onClick={() => startJourney("demo")}
                data-testid="start-judge-demo"
              >
                Start Judge Demo <span className="button-note">starts before Resonance</span>
              </button>
            </div>
          </div>
          <div className="preflight-specimen" role="img" aria-label="Expedition kit preview">
            <div className="specimen-orbit orbit-one" aria-hidden="true" />
            <div className="specimen-orbit orbit-two" aria-hidden="true" />
            <div className="specimen-core" aria-hidden="true">
              <span />
            </div>
            <div className="specimen-annotation annotation-a">ECHO / ready</div>
            <div className="specimen-annotation annotation-b">human lens / closed</div>
            <div className="specimen-caption">
              <span>03 zones</span>
              <span>01 shared signal</span>
            </div>
          </div>
        </section>
        <footer className="preflight-footer">
          <span>Camp beacon → Resonance relay → ancient core</span>
          <span className="preflight-footnote">No account. No back-end. One field note.</span>
        </footer>
      </main>
    );
  }

  const objective = getObjectiveState(snapshot);
  const latestActivity = snapshot.activity.at(-1);
  const party = snapshot.flags.resonanceCalibrated
    ? (["cindra", "grum", "voltyn"] as const)
    : (["cindra", "grum"] as const);

  return (
    <main className="game-shell" data-testid="game-shell">
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
            <span className="hud-sync-state">{busy ? "syncing" : "ready"}</span>
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
              aria-expanded={debugOpen}
              aria-controls="debug-drawer"
              onClick={() => setDebugOpen((current) => !current)}
              data-testid="open-debug-drawer"
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
        {paused ? (
          <div className="paused-overlay" role="status">
            <strong>Expedition paused</strong>
            <span>Press the pause control to return to the field.</span>
            <button type="button" onClick={() => setPaused(false)}>
              Resume expedition
            </button>
          </div>
        ) : null}
        {debugOpen ? (
          <aside className="debug-drawer" id="debug-drawer" aria-label="Debug details">
            <div className="debug-heading">
              <h2>Field diagnostics</h2>
              <button type="button" onClick={() => setDebugOpen(false)}>
                Close
              </button>
            </div>
            <dl>
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
                <dt>busy</dt>
                <dd>{busy ? "true" : "false"}</dd>
              </div>
              <div>
                <dt>WebMCP compatibility</dt>
                <dd>{snapshot.echo.connected ? "available" : "unavailable"}</dd>
              </div>
              <div>
                <dt>capabilities</dt>
                <dd>
                  ignite · break
                  {snapshot.flags.resonanceCalibrated ? " · interface" : ""}
                </dd>
              </div>
            </dl>
            <div className="debug-events">
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
          </aside>
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

export const createInitialSnapshotForPreview = () => INITIAL_SNAPSHOT;
