import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { WildGentApp } from "./app";
import { type AppRuntime, getAppRuntime } from "./app-runtime";
import { registerWebMcp, type WebMcpRegistration } from "./webmcp";
import "./styles.css";

declare global {
  interface Window {
    wildgentAppRuntime?: AppRuntime;
    wildgentWebMcp?: WebMcpRegistration;
  }
}

const mount = document.getElementById("root");

if (!mount) throw new Error("WildGent root mount is missing.");

try {
  const runtime = getAppRuntime();
  window.wildgentAppRuntime = runtime;
  const webMcp = registerWebMcp(runtime.gameEnginePort, {
    hasResonance: (candidate) => {
      if (typeof candidate !== "object" || candidate === null) return false;
      const snapshot = candidate as Record<string, unknown>;
      const resonance = snapshot.resonance;
      return (
        snapshot.voltynResonance === true ||
        (typeof resonance === "object" &&
          resonance !== null &&
          (resonance as Record<string, unknown>).occurred === true) ||
        (Array.isArray(snapshot.capabilities) && snapshot.capabilities.includes("interface"))
      );
    },
  });
  window.wildgentWebMcp = webMcp;
  window.addEventListener("beforeunload", () => webMcp.dispose(), { once: true });
  createRoot(mount).render(
    <StrictMode>
      <WildGentApp runtime={runtime} webMcp={webMcp} />
    </StrictMode>,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : "The local field kit is unavailable.";
  mount.innerHTML = `<main class="landing-page preflight" data-testid="landing-page"><div class="preflight-copy"><p class="signal-kicker"><span class="signal-dot"></span> Field kit error</p><h1>The map is still being<br><em>assembled.</em></h1><p class="preflight-dek">${message}</p></div></main>`;
}
