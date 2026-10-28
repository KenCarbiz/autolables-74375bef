import { describe, it, expect } from "vitest";
import { aggregateEvents, crawlOutcomeToCall, deriveProviderCard, PROVIDER_CARDS, providerDrillIn, registryEntitlement, registryTtlHours, type ProviderCardSpec, type ProviderEventRow } from "./providers";

const NOW = Date.parse("2026-10-24T14:30:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const spec = (id: string): ProviderCardSpec => PROVIDER_CARDS.find((c) => c.id === id) as ProviderCardSpec;

const ev = (product: string, outcome: string, h: number): ProviderEventRow => ({ at: hoursAgo(h), product, outcome, http_status: outcome === "ok" ? 200 : outcome === "refused_rate" ? 429 : null });

describe("aggregateEvents", () => {
  it("treats an admission as an attempt but never as an outcome", () => {
    const agg = aggregateEvents([ev("inventory_search", "admitted", 1), ev("inventory_search", "ok", 5), ev("inventory_search", "refused_rate", 3)], ["inventory_search"]);
    expect(agg.attempts).toBe(3);
    expect(agg.lastOutcome).toBe("refused_rate");
    expect(agg.lastSuccessAt).toBe(hoursAgo(5));
    expect(agg.refusals).toBe(1);
  });

  it("ignores other products", () => {
    expect(aggregateEvents([ev("neovin", "ok", 1)], ["inventory_search"]).attempts).toBe(0);
  });
});

describe("registry knowledge", () => {
  it("reads entitlement and freshness from the registry", () => {
    expect(registryEntitlement(["syndication"])).toBe("entitled");
    expect(registryEntitlement(["autorecalls"])).toBe("blocked");
    expect(registryEntitlement(["fsbo"])).toBe("not_applicable");
    expect(registryEntitlement(["no-such-key"])).toBe("unknown");
    expect(registryTtlHours(["syndication"])).toBe(24);
    expect(registryTtlHours(["neovin", "basic_decode"])).toBeNull();
  });

  it("maps crawl outcomes onto the call vocabulary", () => {
    expect(crawlOutcomeToCall("captured")).toBe("ok");
    expect(crawlOutcomeToCall("render_rate_limited")).toBe("refused_rate");
    expect(crawlOutcomeToCall("bot_challenge")).toBe("provider_error");
    expect(crawlOutcomeToCall(null)).toBeNull();
  });
});

describe("deriveProviderCard", () => {
  const flags = { blackbook: false };

  it("marks a failed telemetry read unknown, never healthy", () => {
    const card = deriveProviderCard({ spec: spec("active_search"), events: null, flags, backendOk: null, now: NOW });
    expect(card.verdict.state).toBe("unknown");
    expect(card.verdict.headline).toBe("Provider status could not be read");
  });

  it("reports entitlement blocked from the registry and from a refused credential", () => {
    expect(deriveProviderCard({ spec: spec("autorecalls"), events: [], flags, backendOk: true, now: NOW }).verdict.state).toBe("entitlement_blocked");
    const refused = deriveProviderCard({ spec: spec("active_search"), events: [ev("inventory_search", "refused_auth", 1)], flags, backendOk: true, now: NOW });
    expect(refused.verdict.state).toBe("entitlement_blocked");
    expect(refused.entitlement).toBe("refused");
  });

  it("applies the registry freshness window and treats immutable answers as never stale", () => {
    const stale = deriveProviderCard({ spec: spec("active_search"), events: [ev("inventory_search", "ok", 240)], flags, backendOk: true, now: NOW });
    expect(stale.verdict.state).toBe("stale");
    const history = deriveProviderCard({ spec: spec("vin_history"), events: [ev("vin_history", "ok", 480)], flags, backendOk: true, now: NOW });
    expect(history.verdict.state).toBe("healthy");
    const decode = deriveProviderCard({ spec: spec("neovin"), events: [ev("neovin", "ok", 24 * 700)], flags, backendOk: true, now: NOW });
    expect(decode.verdict.state).toBe("healthy");
  });

  it("degrades on a quota refusal while keeping cached answers in use", () => {
    const card = deriveProviderCard({ spec: spec("syndication"), events: [ev("dealer_inventory_syndication", "refused_quota", 8), ev("dealer_inventory_syndication", "ok", 56)], flags, backendOk: true, now: NOW });
    expect(card.verdict.state).toBe("degraded");
    expect(card.verdict.headline).toBe("Monthly quota reached");
    expect(card.refusals).toBe(1);
  });

  it("keeps Black Book not configured until the feature is on", () => {
    expect(deriveProviderCard({ spec: spec("blackbook"), events: [], flags: { blackbook: false }, backendOk: true, now: NOW }).verdict.state).toBe("not_configured");
    const on = deriveProviderCard({ spec: spec("blackbook"), events: [], flags: { blackbook: true }, backendOk: true, now: NOW });
    expect(on.verdict.state).not.toBe("healthy");
  });

  it("reads the crawl ledger and the backend read result", () => {
    expect(deriveProviderCard({ spec: spec("dealer_site"), events: [], crawl: null, flags, backendOk: true, now: NOW }).verdict.state).toBe("unknown");
    const limited = deriveProviderCard({ spec: spec("dealer_site"), events: [], crawl: { lastAttemptAt: hoursAgo(2), lastSuccessAt: hoursAgo(30), lastOutcome: "render_rate_limited", attempts: 40 }, flags, backendOk: true, now: NOW });
    expect(limited.verdict.state).toBe("degraded");
    expect(deriveProviderCard({ spec: spec("backend"), events: [], flags, backendOk: null, now: NOW }).verdict.state).toBe("unknown");
    expect(deriveProviderCard({ spec: spec("backend"), events: [], flags, backendOk: true, now: NOW }).verdict.state).toBe("healthy");
    expect(deriveProviderCard({ spec: spec("backend"), events: [], flags, backendOk: false, now: NOW }).verdict.state).toBe("degraded");
  });

  it("drills the feed card into the newest real run when one exists", () => {
    expect(providerDrillIn(spec("syndication"), "run-9")).toBe("/admin/integrations/runs/run-9");
    expect(providerDrillIn(spec("syndication"), null)).toBe("/admin?tab=inventory-feed");
    expect(providerDrillIn(spec("mds"), "run-9")).toBe("/admin?tab=data-quality");
  });
});
