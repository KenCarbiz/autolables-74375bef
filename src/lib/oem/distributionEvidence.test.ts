import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deliveryForVehicle, explainDecision, type OemDistributionEvent } from "./distributionEvidence";

const ev = (over: Partial<OemDistributionEvent> = {}): OemDistributionEvent => ({
  vin: "3PCAJ5JR1SF103167",
  brand: "infiniti",
  document_kind: "owners_manual",
  decision: "host",
  decided_at: "2026-07-29T12:00:00Z",
  evidence: {
    franchise_brands: [{ brand: "infiniti", new_units: 14 }],
    min_new_units_required: 3,
    brand_blocked: false,
  },
  ...over,
});

describe("what the customer keeps", () => {
  it("stays hosted once it was ever hosted", () => {
    expect(deliveryForVehicle([ev()], "owners_manual")).toBe("host");
  });

  it("survives the dealer later losing the franchise", () => {
    // The later 'link' row records the change of circumstances; it does not
    // reach into a passport somebody already owns.
    const log = [ev(), ev({ decision: "link", decided_at: "2029-01-04T00:00:00Z" })];
    expect(deliveryForVehicle(log, "owners_manual")).toBe("host");
  });

  it("keeps the two document kinds separate", () => {
    expect(deliveryForVehicle([ev()], "brochure")).toBe("link");
  });

  it("links when it was never hosted", () => {
    expect(deliveryForVehicle([ev({ decision: "link" })], "owners_manual")).toBe("link");
  });

  it("links when the log could not be read", () => {
    expect(deliveryForVehicle(null, "owners_manual")).toBe("link");
    expect(deliveryForVehicle(undefined, "owners_manual")).toBe("link");
  });
});

describe("explaining a decision to an inquiry", () => {
  it("states the franchise and the evidence that supported it", () => {
    const text = explainDecision(ev());
    expect(text).toContain("July 29, 2026");
    expect(text).toContain("franchised INFINITI retailer");
    expect(text).toContain("14 new INFINITI units");
    expect(text).toContain("threshold of 3");
  });

  it("states why a link was a link", () => {
    const text = explainDecision(ev({
      decision: "link", brand: "honda",
      evidence: { franchise_brands: [{ brand: "infiniti", new_units: 14 }], min_new_units_required: 3 },
    }));
    expect(text).toContain("linked to the manufacturer, not served");
    expect(text).toContain("no HONDA new-vehicle franchise");
    expect(text).toContain("0 new units");
  });

  it("names a takedown as the reason when that is the reason", () => {
    const text = explainDecision(ev({
      decision: "link",
      evidence: { franchise_brands: [{ brand: "infiniti", new_units: 14 }], min_new_units_required: 3, brand_blocked: true },
    }));
    expect(text).toContain("under a distribution block");
  });

  it("reads the captured evidence, not today's", () => {
    // A row whose snapshot says 4 units must still say 4 years later, even
    // though the dealer now has none.
    const text = explainDecision(ev({
      evidence: { franchise_brands: [{ brand: "infiniti", new_units: 4 }], min_new_units_required: 3 },
    }));
    expect(text).toContain("4 new INFINITI units");
  });
});

describe("the log is evidence, not logging", () => {
  const sql = readFileSync(
    join(__dirname, "..", "..", "..", "supabase/migrations/20260729150000_oem_distribution_evidence.sql"),
    "utf8",
  );

  it("is append-only by TRIGGER, because RLS does not bind the service role", () => {
    // Every writer here is the service role, so a policy alone would protect
    // nothing at all.
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON public\.oem_distribution_events/);
    expect(sql).toMatch(/RAISE EXCEPTION 'oem_distribution_events is append-only/);
  });

  it("takes the decision from the gate, never from the caller", () => {
    const fn = sql.slice(
      sql.indexOf("FUNCTION public.record_oem_distribution"),
      sql.indexOf("FUNCTION public.oem_distribution_for_vehicle"),
    );
    const signature = fn.slice(0, fn.indexOf("RETURNS TABLE"));
    expect(signature).not.toMatch(/_decision/);
    expect(fn).toMatch(/v_may := public\.tenant_may_host_oem_documents/);
    expect(fn).toMatch(/v_decision := CASE WHEN v_may THEN 'host' ELSE 'link' END/);
  });

  it("snapshots the franchise counts and the threshold in force", () => {
    expect(sql).toMatch(/'franchise_brands'/);
    expect(sql).toMatch(/'min_new_units_required', public\.oem_franchise_min_new_units\(\)/);
    expect(sql).toMatch(/'brand_blocked'/);
  });

  it("never records a stored path for a link decision", () => {
    // A path on a 'link' row would suggest we kept a copy we had no right to.
    expect(sql).toMatch(/CASE WHEN v_may THEN _stored_path ELSE NULL END/);
  });

  it("resolves a vehicle to host if it was ever hosted", () => {
    const fn = sql.slice(sql.indexOf("FUNCTION public.oem_distribution_for_vehicle"));
    expect(fn).toMatch(/e\.decision = 'host'/);
    expect(fn).toMatch(/THEN 'host' ELSE 'link' END/);
  });

  it("does not let the customer's record die with the listing", () => {
    // No FK cascade from vehicle_listings: the evidence has to outlive it.
    expect(sql).toMatch(/vehicle_listing_id UUID,/);
    expect(sql).not.toMatch(/vehicle_listing_id UUID REFERENCES/);
  });

  it("wraps auth.uid() and scopes the read policy to authenticated", () => {
    expect(sql).toMatch(/FOR SELECT\s*\n\s*TO authenticated/);
    expect(sql).toMatch(/\(SELECT auth\.uid\(\)\)/);
    expect(sql).not.toMatch(/WHERE user_id = auth\.uid\(\)/);
  });

  it("keeps the write RPC off the client", () => {
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.record_oem_distribution\([^)]*\) TO service_role;/);
    expect(sql).not.toMatch(/record_oem_distribution\([^)]*\) TO authenticated/);
  });
});
