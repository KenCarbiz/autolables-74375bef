import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ConsoleFixtureProvider, MutationBlockedError, useConsoleMutation, useConsoleView } from "./dataSource";
import { CONSOLE_SECTIONS, LEGACY_TAB_ALIASES, sectionForPath } from "./sections";

const fixture = { id: "t", views: { overview: { ok: true } }, now: 0 };
const wrap = (withFixture: boolean) => ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter>{withFixture ? <ConsoleFixtureProvider fixture={fixture}>{children}</ConsoleFixtureProvider> : children}</MemoryRouter>
  </QueryClientProvider>
);
const req = { kind: "replay_import", operationKey: "op-1", reason: "test", scope: "store-a", previewVersion: "v1" };

describe("platform console data source", () => {
  it("blocks every action at the fixture adapter", async () => {
    const { result } = renderHook(() => useConsoleMutation(), { wrapper: wrap(true) });
    await expect(result.current(req)).rejects.toBeInstanceOf(MutationBlockedError);
  });

  it("refuses live actions this build has not been authorized to execute", async () => {
    const { result } = renderHook(() => useConsoleMutation(), { wrapper: wrap(false) });
    await expect(result.current(req)).rejects.toThrow(/review-only/);
  });

  it("requires a reason and an operation key before anything else", async () => {
    const { result } = renderHook(() => useConsoleMutation(), { wrapper: wrap(false) });
    await expect(result.current({ ...req, reason: " " })).rejects.toThrow(/reason/);
    await expect(result.current({ ...req, operationKey: "" })).rejects.toThrow(/operation key/);
  });

  it("serves fixture data without running the live loader", () => {
    let called = false;
    const { result } = renderHook(() => useConsoleView("overview", async () => { called = true; return { ok: false }; }), { wrapper: wrap(true) });
    expect(result.current.status).toBe("ready");
    expect(result.current.data).toEqual({ ok: true });
    expect(called).toBe(false);
  });
});

describe("platform console sections", () => {
  it("has the nine sections in order", () => {
    expect(CONSOLE_SECTIONS.map((s) => s.label)).toEqual(["Overview", "Stores", "Connections", "Data & jobs", "Usage & billing", "Access", "Templates", "Audit", "Reliability"]);
  });

  it("maps every legacy /platform-admin tab to a console section", () => {
    for (const tab of ["health", "tenants", "members", "entitlements", "audit", "recalls", "billing", "stripe", "templates", "passport-engagement", "api-usage", "budgets"]) {
      expect(LEGACY_TAB_ALIASES[tab]).toMatch(/^\/platform-console/);
    }
  });

  it("keeps child routes under their parent section", () => {
    expect(sectionForPath("/platform-console/incidents/INC-1")).toBe("overview");
    expect(sectionForPath("/platform-console/actions/A1")).toBe("connections");
    expect(sectionForPath("/platform-console/data/imports/IMP-1")).toBe("data");
    expect(sectionForPath("/platform-console/usage/billing")).toBe("usage");
  });
});
