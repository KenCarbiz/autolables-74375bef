import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import type { ActionRequest, ActionResult } from "./types";

// Console views read through useConsoleView. In production there is no fixture
// context and every view loads live, bounded data. The development-only
// fixture route mounts ConsoleFixtureProvider so the visual harness can render
// each reference screen from synthetic data. Mutations always go through
// useConsoleMutation: the fixture adapter refuses every one, and the live
// adapter refuses anything this build has not been authorized to execute.

export interface ConsoleFixture {
  id: string;
  /** Keyed by view id; each view owns its slice type. */
  views: Record<string, unknown>;
  /** Frozen clock (ms) so relative times are stable. */
  now: number;
  /** Simulates the live channel state for the disconnected reference. */
  connection?: "connected" | "disconnected";
  /** Environment label drawn by the reference (synthetic). */
  environment?: string;
}

const FixtureContext = createContext<ConsoleFixture | null>(null);

export const ConsoleFixtureProvider = ({ fixture, children }: { fixture: ConsoleFixture; children: ReactNode }) => (
  <FixtureContext.Provider value={fixture}>{children}</FixtureContext.Provider>
);

export const useConsoleFixture = () => useContext(FixtureContext);

/** The console path being rendered. Fixture routes render a console path that differs from the URL. */
const PathContext = createContext<string | null>(null);
export const ConsolePathProvider = ({ path, children }: { path: string; children: ReactNode }) => (
  <PathContext.Provider value={path}>{children}</PathContext.Provider>
);
export function useConsolePath(): string {
  const override = useContext(PathContext);
  const { pathname } = useLocation();
  return override ?? pathname;
}

export function useConsoleNow(): number {
  const fixture = useContext(FixtureContext);
  return fixture?.now ?? Date.now();
}

export type ViewStatus = "loading" | "ready" | "empty" | "denied" | "timeout" | "error";

export interface ViewResult<T> {
  status: ViewStatus;
  data: T | null;
  error: string | null;
  /** ms epoch of the last successful load. */
  updatedAt: number | null;
  refresh: () => void;
  isFixture: boolean;
}

export const VIEW_TIMEOUT_MS = 15_000;

export class ConsoleTimeoutError extends Error {
  constructor() {
    super("The request did not finish within 15 seconds.");
  }
}

export class ConsoleDeniedError extends Error {
  constructor(message = "Your account is not authorized for this scope.") {
    super(message);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new ConsoleTimeoutError()), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function looksDenied(e: unknown): boolean {
  if (e instanceof ConsoleDeniedError) return true;
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /permission denied|not authorized|forbidden|42501|jwt/i.test(msg);
}

/**
 * Load a view's model. `load` runs only in live mode and must read recorded
 * telemetry (database rows, RPCs) — never a paid provider endpoint.
 */
export function useConsoleView<T>(
  viewId: string,
  load: () => Promise<T>,
  opts: { isEmpty?: (data: T) => boolean; key?: unknown[] } = {},
): ViewResult<T> {
  const fixture = useContext(FixtureContext);
  const query = useQuery({
    queryKey: ["platform-console", viewId, ...(opts.key ?? [])],
    queryFn: () => withTimeout(load(), VIEW_TIMEOUT_MS),
    enabled: fixture === null,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  if (fixture) {
    const data = (fixture.views[viewId] as T | undefined) ?? null;
    return { status: data === null ? "empty" : "ready", data, error: null, updatedAt: fixture.now, refresh: () => {}, isFixture: true };
  }

  const refresh = () => { void query.refetch(); };
  if (query.isPending) return { status: "loading", data: null, error: null, updatedAt: null, refresh, isFixture: false };
  if (query.isError) {
    const e = query.error;
    const status: ViewStatus = e instanceof ConsoleTimeoutError ? "timeout" : looksDenied(e) ? "denied" : "error";
    return { status, data: null, error: e instanceof Error ? e.message : String(e), updatedAt: null, refresh, isFixture: false };
  }
  const data = query.data ?? null;
  const empty = data === null || (opts.isEmpty ? opts.isEmpty(data) : false);
  return { status: empty ? "empty" : "ready", data, error: null, updatedAt: query.dataUpdatedAt || null, refresh, isFixture: false };
}

export class MutationBlockedError extends Error {}

/** Live actions this build is allowed to execute. Empty: replay, retry and resume are review-only. */
const LIVE_EXECUTABLE_ACTIONS = new Set<string>();

export function useConsoleMutation() {
  const fixture = useContext(FixtureContext);
  return async (req: ActionRequest): Promise<ActionResult> => {
    if (!req.reason.trim()) throw new MutationBlockedError("A reason is required.");
    if (!req.operationKey) throw new MutationBlockedError("An operation key is required.");
    if (fixture) {
      throw new MutationBlockedError("Design fixture: actions are blocked and nothing was sent.");
    }
    if (!LIVE_EXECUTABLE_ACTIONS.has(req.kind)) {
      throw new MutationBlockedError("This action is review-only in this release. No request was sent.");
    }
    throw new MutationBlockedError("No executor is registered for this action.");
  };
}
