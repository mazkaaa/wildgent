import { useEffect, useState } from "react";

import type { GameSnapshot } from "./app-model";
import type { AppPath, AppRouteNavigation } from "./app-route";
import type { AppRuntime } from "./app-runtime";

type LandingPageProps = {
  snapshot: GameSnapshot;
  runtime: AppRuntime;
  onNavigate: (path: AppPath, options?: AppRouteNavigation) => void;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const savedExpeditionDetail = (snapshot: GameSnapshot) => {
  if (snapshot.phase === "complete") return "The Ancient Core is yours.";
  if (snapshot.phase === "battle") return "The guardian is waiting at the edge of the core.";
  return "Your field note is waiting in the living world.";
};

export function LandingPage({ snapshot, runtime, onNavigate }: LandingPageProps) {
  const [busy, setBusy] = useState(runtime.coordinator.isBusy);
  const [error, setError] = useState<string | null>(null);
  const hasSavedExpedition = snapshot.phase !== "preflight";

  useEffect(() => runtime.subscribeBusy(setBusy), [runtime]);

  const startJourney = async (mode: "journey" | "demo") => {
    if (busy) return;
    setError(null);
    const result = await runtime.dispatch({
      type: mode === "demo" ? "START_DEMO" : "START_JOURNEY",
    });
    if (!result.ok) {
      setError(
        result.code === "BUSY"
          ? "The field lens is still resolving the last move."
          : "The field kit could not begin that expedition.",
      );
      return;
    }
    if (isRecord(result.value) && result.value.ok === false) {
      setError(
        typeof result.value.message === "string"
          ? result.value.message
          : "The field kit could not begin that expedition.",
      );
      return;
    }
    onNavigate("/play", { intent: "start" });
  };

  return (
    <div data-testid="landing-page">
      <main
        className="landing-page preflight"
        data-testid="preflight-screen"
        data-route-focus="landing"
        tabIndex={-1}
      >
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
                onClick={() => void startJourney("journey")}
                disabled={busy}
                data-testid="start-journey"
              >
                Begin journey <span aria-hidden="true">↗</span>
              </button>
              <button
                className="button button-quiet"
                type="button"
                onClick={() => void startJourney("demo")}
                disabled={busy}
                data-testid="start-judge-demo"
              >
                Start Judge Demo <span className="button-note">starts before Resonance</span>
              </button>
            </div>
            {hasSavedExpedition ? (
              <div className="landing-saved" data-testid="saved-expedition">
                <div className="landing-saved-copy">
                  <span className="landing-saved-mark" aria-hidden="true" />
                  <span>
                    <strong>Expedition saved</strong>
                    <small>{savedExpeditionDetail(snapshot)}</small>
                  </span>
                </div>
                <a
                  className="button button-continue"
                  href="/play"
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
                    onNavigate("/play", { intent: "continue" });
                  }}
                  data-testid="continue-journey"
                >
                  Continue journey <span aria-hidden="true">↗</span>
                </a>
              </div>
            ) : null}
            {error ? (
              <p className="landing-error" role="alert">
                {error}
              </p>
            ) : null}
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
    </div>
  );
}
