// Regression suite for the Nov 7 2026 verification-accuracy fix, driven by the
// two real Passports Ken checked on autolabels.io:
//   archived  2023 INFINITI Q50   /v/2023-infiniti-q50-543599
//   active    2022 INFINITI QX55  /v/3pcaj5l32nf114756-511f25
// The fixtures are the production rows (read-only, Nov 7) shaped as
// public-listing-view ships them. Every surface must report the same eight
// statuses and the same totals, and a missing source never reads as clean.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import fx from "@/lib/passport/__fixtures__/livePassports.2026-11-07.json";
import type { VehicleListing } from "@/hooks/useVehicleListing";
import { governedPassportData } from "@/lib/passport/publicSurface";
import {
  deriveVerificationReport, verificationCountsLine, verificationScopeLine, verificationStatusCounts,
  verificationSnapshotKey, summarizeVerificationExceptions, recallHeadline, type VerificationReport,
} from "@/lib/passport/verificationSummary";
import AutoLabelsVerifiedCard from "@/components/passport/AutoLabelsVerifiedCard";

let current: VehicleListing;
vi.mock("@/hooks/usePublicListing", () => ({
  usePublicListing: () => ({ listing: current, loading: false, notFound: false, rateLimited: false }),
}));
vi.mock("@/hooks/usePublishedWindowSticker", () => ({ usePublishedWindowSticker: () => ({ data: null, isLoading: false }) }));
vi.mock("@/lib/engagement/customerEngagement", () => ({
  trackCustomerEngagement: vi.fn(), trackPassportOpened: vi.fn(), trackWindowStickerScanned: vi.fn(), trackCustomerCtaClicked: vi.fn(), trackLeadSubmitted: vi.fn(),
}));

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const archivedQ50 = (): VehicleListing => clone((fx as unknown as Record<string, VehicleListing>).archivedQ50);
const activeQX55 = (): VehicleListing => clone((fx as unknown as Record<string, VehicleListing>).activeQX55);

const reportOf = (l: VehicleListing): VerificationReport => deriveVerificationReport(governedPassportData(l)!, l);
const statuses = (r: VerificationReport) => Object.fromEntries(r.checks.map((c) => [c.key, c.status]));
const sum = (r: VerificationReport) =>
  r.verifiedChecks + r.dealerAttestedChecks + r.needsAttentionChecks + r.needsConfirmationChecks + r.pendingChecks + r.unavailableChecks;

const COMPLETE_HISTORY = { accident_count: 0, owner_count: 1, carfax_clean_title: true };
const VIN_CLEAR = (vin: string) => ({
  vin, scope: "vin", source: "marketcheck_autorecalls", state: "clear", has_open: false,
  open_recall_count: 0, campaigns: [], checked_at: new Date().toISOString(),
});
const freshMarket = (l: VehicleListing, value: number) => {
  const now = new Date().toISOString();
  Object.assign(l as object, {
    market_value: value, market_checked_at: now,
    market_payload: { marketValue: value, low: value - 2000, high: value + 2000, checked_at: now },
  });
};
const WARRANTY = { factory_months: 48, factory_miles: 60000, powertrain_months: 72, powertrain_miles: 70000, in_service_date: "2023-03-01" };

describe("the two live Passports: one status per check, totals reconcile", () => {
  it("archived 2023 Q50 reads 3 verified, 1 dealer attested, 4 not available", () => {
    const r = reportOf(archivedQ50());
    expect(statuses(r)).toEqual({
      vin: "verified", history: "unavailable", ownership: "verified", odometer: "verified",
      // The Sept 11 market read is withheld by the tenant's invalid-claim
      // suppression, so the market check has no result to show.
      title: "dealer_attested", recall: "unavailable", market: "unavailable", warranty: "unavailable",
    });
    expect(r.totalChecks).toBe(8);
    expect(sum(r)).toBe(8);
    expect(verificationScopeLine(r)).toBe("3 of 8 checks verified");
    expect(verificationCountsLine(r)).toBe("3 verified · 1 dealer attested · 4 not available");
    // Nothing asks the shopper to review anything, and nothing is pending.
    expect(r.banner.reviewCount).toBe(0);
    expect(r.banner.heading).toBe("3 of 8 checks verified");
    expect(r.banner.tone).toBe("neutral");
  });

  it("active 2022 QX55 reads 0 verified: its VIN decode, history, market and warranty never returned", () => {
    const r = reportOf(activeQX55());
    expect(statuses(r)).toEqual({
      vin: "unavailable", history: "unavailable", ownership: "unavailable", odometer: "unavailable",
      title: "dealer_attested", recall: "pending", market: "unavailable", warranty: "unavailable",
    });
    expect(sum(r)).toBe(8);
    expect(verificationScopeLine(r)).toBe("0 of 8 checks verified");
    expect(verificationCountsLine(r)).toBe("1 dealer attested · 1 pending · 6 not available");
    expect(r.banner.reviewCount).toBe(0);
    expect(r.banner.tone).not.toBe("green");
  });

  it("dealer feed text ('One Owner - Clean Car-Fax') is never treated as a history or title source", () => {
    const l = activeQX55();
    expect((l.features ?? []).join(" ")).toMatch(/Clean Car-Fax/);
    const r = reportOf(l);
    expect(r.checks.find((c) => c.key === "ownership")!.status).toBe("unavailable");
    expect(r.checks.find((c) => c.key === "title")!.status).not.toBe("verified");
    expect(JSON.stringify(r.checks.map((c) => c.finding))).not.toMatch(/clean title|no accidents|one owner/i);
  });
});

describe("complete vs incomplete data, archived and active", () => {
  it("archived with complete data verifies all eight", () => {
    const l = archivedQ50();
    Object.assign(l.mc_attributes as object, COMPLETE_HISTORY);
    (l as unknown as Record<string, unknown>).recall_check = VIN_CLEAR(l.vin!);
    (l as unknown as Record<string, unknown>).warranty_info = WARRANTY;
    freshMarket(l, 60850);
    const r = reportOf(l);
    expect(r.verifiedChecks).toBe(8);
    expect(r.banner.tone).toBe("green");
    expect(verificationScopeLine(r)).toBe("8 of 8 checks verified");
  });

  it("active with complete data verifies all eight", () => {
    const l = activeQX55();
    (l as unknown as Record<string, unknown>).mc_attributes = { specs_decoded_at: "2026-11-07T00:00:00Z", specs_source: "neovin", ...COMPLETE_HISTORY };
    (l as unknown as Record<string, unknown>).recall_check = VIN_CLEAR(l.vin!);
    (l as unknown as Record<string, unknown>).warranty_info = WARRANTY;
    freshMarket(l, 31000);
    const r = reportOf(l);
    expect(statuses(r)).toEqual({
      vin: "verified", history: "verified", ownership: "verified", odometer: "verified",
      title: "verified", recall: "verified", market: "verified", warranty: "verified",
    });
  });

  it("verified and dealer attested are counted apart", () => {
    const r = reportOf(archivedQ50());
    expect(r.verifiedChecks).toBe(3);
    expect(r.dealerAttestedChecks).toBe(1);
    const title = r.checks.find((c) => c.key === "title")!;
    expect(title.family).toBe("dealer");
    expect(title.finding).toMatch(/not an independent title-record check/);
  });
});

describe("a missing provider response never becomes a clean result", () => {
  it("no recall response is pending, never 'No recalls'", () => {
    const r = reportOf(activeQX55());
    const recall = r.checks.find((c) => c.key === "recall")!;
    expect(recall.status).toBe("pending");
    expect(recallHeadline(recall)).not.toMatch(/no open recalls/i);
    expect(recall.finding ?? "").not.toMatch(/no open (safety )?recalls/i);
  });

  it("a VIN lookup that ran and found no record is unavailable, never 'No recalls'", () => {
    const recall = reportOf(archivedQ50()).checks.find((c) => c.key === "recall")!;
    expect(recall.status).toBe("unavailable");
    expect(recallHeadline(recall)).toBe("Recall not verified for this VIN");
  });

  it("no history response is unavailable, never 'No accidents'", () => {
    const history = reportOf(activeQX55()).checks.find((c) => c.key === "history")!;
    expect(history.status).toBe("unavailable");
    expect(history.finding).toBeNull();
  });

  it("no title result and no dealer policy is pending, never 'Clean title'", () => {
    const l = activeQX55();
    delete (l as unknown as Record<string, unknown>).title_policy_no_branded;
    const title = reportOf(l).checks.find((c) => c.key === "title")!;
    expect(title.status).toBe("pending");
    expect(title.finding).toBeNull();
  });

  it("a VIN decode attempt that returned nothing does not verify identity", () => {
    const vin = reportOf(activeQX55()).checks.find((c) => c.key === "vin")!;
    expect(vin.status).toBe("unavailable");
    expect(vin.finding).toBeNull();
  });
});

describe("conflicts and refreshes", () => {
  it("conflicting recall sources read needs confirmation", () => {
    const l = archivedQ50();
    (l as unknown as Record<string, unknown>).recall_check = VIN_CLEAR(l.vin!);
    (l as unknown as Record<string, unknown>).recall_payload = {
      scope: "vin", source: "nhtsa", state: "open", has_open: true, open_recall_count: 1, checked_at: new Date().toISOString(),
      campaigns: [{ campaignNumber: "26V-001", component: "Brakes", summary: "Brake hose may leak." }],
    };
    const r = reportOf(l);
    expect(["needs_confirmation", "needs_attention"]).toContain(r.checks.find((c) => c.key === "recall")!.status);
    expect(r.banner.reviewCount).toBe(1);
    expect(sum(r)).toBe(8);
  });

  it("a source refresh moves exactly one check and changes the report version", () => {
    const before = reportOf(archivedQ50());
    const l = archivedQ50();
    (l as unknown as Record<string, unknown>).recall_check = VIN_CLEAR(l.vin!);
    const after = reportOf(l);
    expect(before.checks.find((c) => c.key === "recall")!.status).toBe("unavailable");
    expect(after.checks.find((c) => c.key === "recall")!.status).toBe("verified");
    expect(after.verifiedChecks).toBe(before.verifiedChecks + 1);
    expect(after.unavailableChecks).toBe(before.unavailableChecks - 1);
    expect(verificationSnapshotKey(after, l.vin)).not.toBe(verificationSnapshotKey(before, l.vin));
  });

  it("the same VIN, snapshot and version always produce the same report", () => {
    const a = reportOf(archivedQ50());
    const b = reportOf(archivedQ50());
    expect(statuses(a)).toEqual(statuses(b));
    expect(verificationSnapshotKey(a, "JN1EV7CR5PM543599")).toBe(verificationSnapshotKey(b, "JN1EV7CR5PM543599"));
  });
});

describe("every summary surface reports the same counts", () => {
  afterEach(cleanup);

  for (const [name, make] of [["archived Q50", archivedQ50], ["active QX55", activeQX55]] as const) {
    it(`${name}: hero card tiles, counts line and module summary agree`, () => {
      const r = reportOf(make());
      const { container } = render(<AutoLabelsVerifiedCard report={r} onOpenReport={() => {}} />);
      const tiles = container.querySelector("[data-verification-tiles]")!.getAttribute("data-verification-tiles")!;
      const fromTiles = Object.fromEntries(tiles.split(",").map((p) => { const [k, v] = p.split(":"); return [k, Number(v)]; }));
      const fromReport = Object.fromEntries(verificationStatusCounts(r).map((s) => [s.status, s.count]));
      expect(fromTiles).toEqual(fromReport);
      expect(Object.values(fromTiles).reduce((x, y) => x + y, 0)).toBe(8);
      // No "AutoLabels Verified · 8 data checks completed", no collapsed review bucket.
      expect(container.textContent).not.toMatch(/AutoLabels Verified|checks completed|Needs review/);
      expect(container.textContent).toContain(verificationScopeLine(r));
      // The module subtitle segment list names the same statuses.
      const summary = summarizeVerificationExceptions(r);
      if (r.pendingChecks) expect(summary).toContain(`${r.pendingChecks} pending`);
      if (r.unavailableChecks) expect(summary).toContain(`${r.unavailableChecks} not available`);
    });
  }
});

// ── The served page, both breakpoints ──────────────────────────────────────
import VehiclePassportGoverned from "./VehiclePassportGoverned";

const setDesktop = (desktop: boolean) => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true, writable: true,
    value: (q: string) => ({ matches: desktop, media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }),
  });
};
const renderPage = (slug: string) => render(
  <HelmetProvider>
    <MemoryRouter initialEntries={[`/v/${slug}`]}>
      <Routes><Route path="/v/:slug" element={<VehiclePassportGoverned />} /></Routes>
    </MemoryRouter>
  </HelmetProvider>,
);

describe("served Passport: archived photo treatment and badges", () => {
  beforeEach(() => { if (!("IntersectionObserver" in window)) (window as unknown as Record<string, unknown>).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }; });
  afterEach(cleanup);

  for (const desktop of [false, true]) {
    const bp = desktop ? "desktop" : "mobile";
    it(`${bp}: the archived Q50 labels its dealer photos and keeps the source image`, () => {
      setDesktop(desktop);
      current = archivedQ50();
      const { container } = renderPage(current.slug!);
      const notes = container.querySelectorAll("[data-archived-photo-note]");
      expect(notes.length).toBe(1);
      expect(notes[0].textContent).toMatch(/not a current offer/);
      const img = container.querySelector(`img[src="${current.hero_image_url}"]`);
      expect(img).not.toBeNull();
      expect(container.textContent).toMatch(/No longer listed/);
    });

    it(`${bp}: the active QX55 keeps its photos unlabeled and claims no unverified badge`, () => {
      setDesktop(desktop);
      current = activeQX55();
      const { container } = renderPage(current.slug!);
      expect(container.querySelectorAll("[data-archived-photo-note]").length).toBe(0);
      const text = container.textContent ?? "";
      expect(text).not.toMatch(/Clean Title|Dealer Verified|Market Data Verified|Dealer-verified listing/);
      expect(text).not.toMatch(/AutoLabels Verified|8 data checks completed/);
      const card = container.querySelector('[data-module="verification-card"]');
      expect(card).not.toBeNull();
      expect(within(card as HTMLElement).getByText("0 of 8 checks verified")).toBeTruthy();
    });
  }

  it("mobile: the archived Q50 shows no 'Clean Title' badge for a dealer's own title policy", () => {
    setDesktop(false);
    current = archivedQ50();
    const { container } = renderPage(current.slug!);
    expect(container.textContent).not.toMatch(/Clean Title/);
    expect(screen.queryAllByText("3 of 8 checks verified").length).toBeGreaterThan(0);
  });
});
