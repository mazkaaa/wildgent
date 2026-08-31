import { useCallback, useEffect, useState } from "react";

export type AppPath = "/" | "/play";

export type AppRouteIntent = "start" | "continue" | "redirect" | null;

export type AppRouteNavigation = {
  replace?: boolean;
  intent?: Exclude<AppRouteIntent, null>;
};

export type AppRoute = {
  path: AppPath;
  intent: AppRouteIntent;
};

const ROUTE_STATE_KEY = "wildgent";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const normalizePath = (pathname: string): AppPath => (pathname === "/play" ? "/play" : "/");

const normalizeIntent = (value: unknown): AppRouteIntent =>
  value === "start" || value === "continue" || value === "redirect" ? value : null;

const readRoute = (): AppRoute => {
  if (typeof window === "undefined") return { path: "/", intent: null };
  const state = isRecord(window.history.state) ? window.history.state[ROUTE_STATE_KEY] : undefined;
  return {
    path: normalizePath(window.location.pathname),
    intent: isRecord(state) ? normalizeIntent(state.intent) : null,
  };
};

const routeState = (intent: AppRouteIntent) => ({
  [ROUTE_STATE_KEY]: { intent },
});

export const useAppRoute = () => {
  const [route, setRoute] = useState<AppRoute>(readRoute);

  useEffect(() => {
    const handlePopState = () => setRoute(readRoute());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = useCallback((path: AppPath, options: AppRouteNavigation = {}) => {
    if (typeof window === "undefined") return;
    const nextIntent = options.intent ?? null;
    const nextUrl = path === "/play" ? "/play" : "/";
    const state = routeState(nextIntent);
    if (options.replace) window.history.replaceState(state, "", nextUrl);
    else window.history.pushState(state, "", nextUrl);
    setRoute({ path, intent: nextIntent });
  }, []);

  const consumeStartRequest = useCallback(() => {
    if (typeof window === "undefined") return;
    const current = readRoute();
    if (current.path !== "/play" || current.intent !== "start") return;
    window.history.replaceState(routeState(null), "", "/play");
    setRoute({ path: "/play", intent: null });
  }, []);

  return { ...route, navigate, consumeStartRequest };
};
