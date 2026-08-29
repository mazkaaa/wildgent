import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ACTION_LABELS,
  type GameAction,
  type GameSnapshot,
  getCurrentObjective,
  getLandmark,
  getObjectiveState,
  INITIAL_SNAPSHOT,
  type LandmarkId,
  resolveLandmarkAction,
  ZONE_CONTENT,
  type ZoneId,
} from "./app-model";
import type { AppRuntime } from "./app-runtime";
import { WorldScene } from "./rendering/world-scene";

type GameAppProps = {
  runtime: AppRuntime;
};

type RouteItem = {
  id: string;
  label: string;
  detail: string;
  complete: (snapshot: GameSnapshot) => boolean;
  active: (snapshot: GameSnapshot) => boolean;
};

const ROUTE: RouteItem[] = [
  {
    id: "beacon",
    label: "Light the camp beacon",
    detail: "Start the canopy relay.",
    complete: (snapshot) => snapshot.flags.beaconLit,
    active: (snapshot) => snapshot.zone === "camp" && !snapshot.flags.beaconLit,
  },
  {
    id: "resonance",
    label: "Relay Resonance",
    detail: "Tune the copper station.",
    complete: (snapshot) => snapshot.flags.resonanceCalibrated,
    active: (snapshot) =>
      snapshot.zone === "camp" && snapshot.flags.beaconLit && !snapshot.flags.resonanceCalibrated,
  },
  {
    id: "ruins",
    label: "Open the observatory",
    detail: "Clear rubble, power, sigil.",
    complete: (snapshot) => snapshot.flags.sigilRead,
    active: (snapshot) => snapshot.zone === "ruins" && !snapshot.flags.sigilRead,
  },
  {
    id: "signal",
    label: "Find the cyan thread",
    detail: "A human-only discovery.",
    complete: (snapshot) => snapshot.flags.vinesDiscovered,
    active: (snapshot) =>
      snapshot.zone === "ruins" && snapshot.flags.sigilRead && !snapshot.flags.vinesDiscovered,
  },
  {
    id: "guardian",
    label: "Break the guardian's pattern",
    detail: "Battle at the root gate.",
    complete: (snapshot) => snapshot.flags.guardianDefeated,
    active: (snapshot) => snapshot.phase === "battle" || snapshot.zone === "ruins",
  },
  {
    id: "core",
    label: "Enter the ancient core",
    detail: "Close the field note.",
    complete: (snapshot) => snapshot.flags.coreEntered,
    active: (snapshot) => snapshot.zone === "core" && snapshot.flags.guardianDefeated,
  },
];

const statusText = (snapshot: GameSnapshot) => {
  if (snapshot.phase === "complete") return "Signal held";
  if (snapshot.phase === "battle") return "Guardian encounter";
  return snapshot.echo.signalFound ? "Human lens open" : "Echo listening";
};

const formatTime = (timestamp: number) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export function GameApp({ runtime }: GameAppProps) {
  const [snapshot, setSnapshot] = useState<GameSnapshot>(() => runtime.getSnapshot());
  const [busy, setBusy] = useState(runtime.coordinator.isBusy);
  const [selectedLandmark, setSelectedLandmark] = useState<LandmarkId | null>(
    snapshot.selectedLandmark,
  );
  const [error, setError] = useState<string | null>(null);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<WorldScene | null>(null);
  const snapshotRef = useRef(snapshot);
  const gameplayMounted = snapshot.phase !== "preflight";

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

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
          setSelectedLandmark(landmark);
          const content = getLandmark(landmark);
          if (content?.zone === snapshotRef.current.zone)
            void runtime.dispatch({ type: "MOVE_TO", position: content.position, landmark });
        },
        onCellClick: (position, zone) => {
          if (zone !== snapshotRef.current.zone || snapshotRef.current.phase !== "journey") return;
          void runtime.dispatch({ type: "MOVE_TO", position });
        },
        onHumanSignalClick: () => {
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

  const routeProgress = ROUTE.filter((item) => item.complete(snapshot)).length;
  const zoneContent = ZONE_CONTENT[snapshot.zone];
  const selectedContent = activeLandmark ? getLandmark(activeLandmark.id) : undefined;
  const actionResolution = selectedContent
    ? resolveLandmarkAction(selectedContent, snapshot)
    : null;
  const canInteract = actionResolution?.state === "ready" && !busy;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        snapshot.phase !== "journey" ||
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
      if (!move) return;
      event.preventDefault();
      void runtime.enqueueHumanStep(move);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [runtime, snapshot]);

  const startJourney = (mode: "journey" | "demo") => {
    void dispatch({ type: mode === "demo" ? "START_DEMO" : "START_JOURNEY" });
  };

  const handlePrimaryAction = () => {
    if (snapshot.phase === "preflight") return;
    if (snapshot.phase === "battle") return;
    if (snapshot.phase === "complete") return;
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
  };

  const handleZoneTravel = (zone: ZoneId) => {
    if (snapshot.phase !== "journey" || zone === snapshot.zone) return;
    const allowed =
      zone === "ruins" ? snapshot.flags.resonanceCalibrated : snapshot.flags.guardianDefeated;
    if (!allowed) {
      setError(
        zone === "ruins"
          ? "The relay is quiet. Calibrate Resonance before leaving camp."
          : "The guardian still holds the core path.",
      );
      return;
    }
    void dispatch({ type: "TRAVEL_TO", zone });
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

  return (
    <main className="game-shell" data-testid="game-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            W
          </span>
          <span>WildGent</span>
          <span className="topbar-divider" aria-hidden="true" />
          <span className="topbar-context">The Living Signal</span>
        </div>
        <div className="topbar-actions">
          <span className={`status-pill ${snapshot.echo.connected ? "is-live" : ""}`}>
            <span className="status-pip" aria-hidden="true" /> {statusText(snapshot)}
          </span>
          <button
            className="icon-button"
            type="button"
            onClick={() => void runtime.reset({ mode: "journey" })}
            aria-label="Reset expedition"
            title="Reset expedition"
          >
            ↺
          </button>
        </div>
      </header>

      <section className="game-layout">
        <div className="world-column">
          <div className="world-heading">
            <div>
              <span className="zone-index">
                {snapshot.zone === "camp" ? "01" : snapshot.zone === "ruins" ? "02" : "03"} / 03
              </span>
              <h1>{zoneContent.title}</h1>
              <p>{zoneContent.subtitle}</p>
            </div>
            <div className="position-readout">
              <span>GRID</span>
              <strong data-testid="grid-position">
                {String(snapshot.position.x).padStart(2, "0")} ·{" "}
                {String(snapshot.position.y).padStart(2, "0")}
              </strong>
            </div>
          </div>
          <div className="world-frame">
            <canvas
              ref={canvasRef}
              className="world-canvas"
              aria-label={`${zoneContent.title} low-poly expedition map`}
            />
            {sceneError ? (
              <div className="scene-notice" role="status">
                Field lens preview unavailable — the journey controls remain active.
              </div>
            ) : null}
            <div className="world-overlay world-overlay-top">
              <span className="live-indicator">
                <span className="status-pip" aria-hidden="true" /> LIVE MAP
              </span>
              <span className="world-help">click a landmark · arrows / WASD to move</span>
            </div>
            <div className="world-overlay world-overlay-bottom">
              <div className="map-legend">
                <span>
                  <i className="legend-swatch legend-player" /> you
                </span>
                <span>
                  <i className="legend-swatch legend-echo" /> Echo
                </span>
                <span>
                  <i className="legend-swatch legend-landmark" /> landmark
                </span>
              </div>
              <span className="map-scale">1 tile = 1 step</span>
            </div>
          </div>
          <fieldset className="zone-switcher">
            <legend className="sr-only">Connected zones</legend>
            {(["camp", "ruins", "core"] as ZoneId[]).map((zone) => {
              const locked =
                zone === "ruins"
                  ? !snapshot.flags.resonanceCalibrated
                  : zone === "core"
                    ? !snapshot.flags.guardianDefeated
                    : false;
              return (
                <button
                  key={zone}
                  className={`zone-tab ${snapshot.zone === zone ? "is-current" : ""}`}
                  type="button"
                  onClick={() => handleZoneTravel(zone)}
                  disabled={locked || snapshot.zone === zone}
                >
                  <span className="zone-tab-dot" aria-hidden="true" /> {ZONE_CONTENT[zone].title}
                  {locked ? <span className="sr-only"> locked</span> : null}
                </button>
              );
            })}
          </fieldset>
          <fieldset className="landmark-tabs">
            <legend className="sr-only">{zoneContent.title} landmarks</legend>
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
                  disabled={locked || busy}
                  data-testid={`landmark-${landmark.id}`}
                >
                  <span className="landmark-tab-mark" aria-hidden="true">
                    {complete ? "✓" : "·"}
                  </span>
                  {landmark.shortLabel}
                  {locked ? <span className="sr-only"> locked</span> : null}
                </button>
              );
            })}
          </fieldset>
        </div>

        <aside className="mission-rail">
          <section className="rail-block objective-block">
            <div className="rail-label">
              <span>Current objective</span>
              <span>
                {routeProgress} / {ROUTE.length}
              </span>
            </div>
            <h2>{getCurrentObjective(snapshot)}</h2>
            <p>{getObjectiveState(snapshot).detail}</p>
            <div
              className="route-progress"
              role="progressbar"
              aria-label={`${routeProgress} of ${ROUTE.length} objectives complete`}
              aria-valuemin={0}
              aria-valuemax={ROUTE.length}
              aria-valuenow={routeProgress}
            >
              <span style={{ width: `${(routeProgress / ROUTE.length) * 100}%` }} />
            </div>
          </section>

          <section className="rail-block route-block">
            <div className="rail-label">
              <span>Field route</span>
              <span className="route-hint">{busy ? "syncing" : "ready"}</span>
            </div>
            <ol className="route-list">
              {ROUTE.map((item) => {
                const complete = item.complete(snapshot);
                const active = !complete && item.active(snapshot);
                return (
                  <li
                    key={item.id}
                    className={`${complete ? "is-complete" : ""} ${active ? "is-active" : ""}`}
                  >
                    <span className="route-marker" aria-hidden="true">
                      {complete ? "✓" : active ? "·" : ""}
                    </span>
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>

          {snapshot.phase === "battle" && snapshot.battle ? (
            <BattlePanel
              battle={snapshot.battle}
              busy={busy}
              onMove={(move) => void dispatch({ type: "ATTACK", move })}
            />
          ) : null}

          {snapshot.phase !== "battle" && snapshot.phase !== "complete" ? (
            <section className="rail-block action-block">
              <div className="rail-label">
                <span>At the edge of your map</span>
                <span className="action-coordinate">
                  {activeLandmark
                    ? `${activeLandmark.position.x} · ${activeLandmark.position.y}`
                    : "—"}
                </span>
              </div>
              <div className="action-heading">
                <h2>{activeLandmark?.label ?? "A quiet clearing"}</h2>
                <span
                  className={`action-state ${actionResolution?.state === "complete" ? "is-done" : ""}`}
                >
                  {busy
                    ? "syncing"
                    : actionResolution?.state === "complete"
                      ? "complete"
                      : actionResolution?.state === "ready"
                        ? "ready"
                        : actionResolution?.state === "approach"
                          ? "approach"
                          : "locked"}
                </span>
              </div>
              <p>
                {activeLandmark?.description ??
                  "Move across the tiles to bring a landmark into focus."}
              </p>
              {actionResolution && actionResolution.state !== "ready" ? (
                <p className="requirement-note">
                  <span aria-hidden="true">↳</span> {actionResolution.hint}
                </p>
              ) : null}
              <button
                className="button button-action"
                type="button"
                onClick={handlePrimaryAction}
                disabled={!canInteract}
                data-testid="landmark-action"
              >
                {actionResolution?.label ?? activeLandmark?.actionLabel ?? ACTION_LABELS.INTERACT}
                <span aria-hidden="true">↗</span>
              </button>
            </section>
          ) : null}

          {snapshot.phase === "complete" ? (
            <section className="rail-block complete-block" data-testid="complete-panel">
              <span className="complete-seal" aria-hidden="true">
                W
              </span>
              <h2>The forest remembers.</h2>
              <p>
                You carried the cyan thread into the core. Echo can follow the note now; the
                discovery remains yours.
              </p>
              <button
                className="button button-action"
                type="button"
                onClick={() => void runtime.reset({ mode: "journey" })}
              >
                Walk it again <span aria-hidden="true">↗</span>
              </button>
            </section>
          ) : null}

          <section className="rail-block echo-block">
            <div className="rail-label">
              <span>Echo activity</span>
              <span className={`echo-state ${snapshot.echo.signalFound ? "is-found" : ""}`}>
                <span className="status-pip" aria-hidden="true" />{" "}
                {snapshot.echo.signalFound ? "signal held" : "listening"}
              </span>
            </div>
            <div className="echo-message">
              <div className="echo-avatar" aria-hidden="true">
                E
              </div>
              <p>{snapshot.echo.message}</p>
            </div>
            <ul className="echo-capabilities" aria-label="Echo registered capabilities">
              <li>ignite</li>
              <li>break</li>
              {snapshot.flags.resonanceCalibrated ? (
                <li className="is-new">interface · new</li>
              ) : (
                <li className="is-locked">interface · locked</li>
              )}
            </ul>
            <button
              className={`directive-toggle ${snapshot.directives.avoidBattles ? "is-active" : ""}`}
              type="button"
              aria-pressed={snapshot.directives.avoidBattles}
              onClick={() =>
                void dispatch({
                  type: "SET_DIRECTIVE",
                  directive: "avoid-battles",
                  active: !snapshot.directives.avoidBattles,
                })
              }
              disabled={busy}
            >
              <span aria-hidden="true">{snapshot.directives.avoidBattles ? "✓" : "○"}</span>
              Avoid battles
              <small className="directive-meta">human directive</small>
            </button>
            <div className="activity-list" aria-live="polite">
              {snapshot.activity
                .slice(-4)
                .reverse()
                .map((event) => (
                  <div className={`activity-row activity-${event.kind}`} key={event.id}>
                    <span className="activity-marker" aria-hidden="true" />{" "}
                    <span>
                      <strong>{event.label}</strong>
                      <small>{event.detail}</small>
                    </span>
                    <time>{formatTime(event.timestamp)}</time>
                  </div>
                ))}
            </div>
          </section>

          {error ? (
            <div className="error-note" role="alert">
              <span aria-hidden="true">!</span>
              {error}
            </div>
          ) : null}
        </aside>
      </section>
      <footer className="game-footer">
        <span>WildGent / local field note</span>
        <span>
          <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> or arrow keys to move
        </span>
        <span>Echo cannot find what only you can see.</span>
      </footer>
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
  onMove: (move: "resonance" | "guard" | "pulse") => void;
}) {
  const healthWidth = `${Math.max(0, Math.min(100, (battle.enemyHp / battle.enemyMaxHp) * 100))}%`;
  return (
    <section className="rail-block battle-block" data-testid="battle-panel">
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
      </div>
    </section>
  );
}

export const createInitialSnapshotForPreview = () => INITIAL_SNAPSHOT;
