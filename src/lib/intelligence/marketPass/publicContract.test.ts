import { describe, it, expect } from "vitest";
import { buildMarketPassAssessment } from "./assessment";
import { assertPublicContractClean, PublicContractLeakError, toDealerContract, toPublicContract } from "./publicContract";
import { PUBLIC_FORBIDDEN_KEYS, findForbiddenKey, type MarketPassAssessment } from "./contracts";
import { decideMarketPassResponse, type MarketPassCaller } from "./handler";
import { NOW, OTHER_TENANT, TENANT, newRow, providerValuation, settings, usedRow } from "./__fixtures__/rows";
import type { MarketPassRow } from "./rowEvidence";

// A row carrying every private value we hold, so a leak has something to leak.
const loadedRow = (): MarketPassRow => usedRow({
  market_payload: { provider_valuation: providerValuation(31100), blackbook: { retail: 30111, tradein: 27777 } },
  market_meta: {
    ...(usedRow().market_meta as Record<string, unknown>),
    price_percentile: 12, cheaper_count: 3, rank_basis: "x", like_median: 30999, comp_price_cut_count: 4,
    comp_price_cut_total: 6, last_visit_plan: "plan", trim_count: 9,
  },
  mc_attributes: { ...(usedRow().mc_attributes as Record<string, unknown>), acv: 21000, recon_cost: 1400 },
  view_count: 333,
});

const assess = (row: MarketPassRow = loadedRow()) => buildMarketPassAssessment({ row, settings: settings(), nowMs: NOW });

const PRIVATE_VALUES = ["30111", "27777", "21000", "1400", "30999"];

describe("the public contract is an allowlist", () => {
  it("serializes with no private key at any depth and no private value", () => {
    for (const row of [loadedRow(), newRow()]) {
      const json = JSON.stringify(toPublicContract(assess(row)));
      for (const key of PUBLIC_FORBIDDEN_KEYS) expect(json, key).not.toContain(`"${key}"`);
      for (const v of PRIVATE_VALUES) expect(json, v).not.toContain(v);
      expect(json).not.toContain("Market Desirability");
    }
  });

  it("carries exactly the allowlisted top-level and indicator keys", () => {
    const c = toPublicContract(assess());
    expect(Object.keys(c).sort()).toEqual(["assessmentVersion", "audience", "computedAt", "contractVersion", "inputsHash", "priceFairness", "rulesStatus", "vehicle", "vehicleConfidence"]);
    expect(Object.keys(c.vehicle).sort()).toEqual(["vehicleType", "vin"]);
    expect(Object.keys(c.priceFairness).sort()).toEqual([
      "ariaLabel", "basis", "benchmarkIsEstimate", "benchmarkLabel", "comparables", "deltaDenominator", "deltaDollars",
      "deltaPct", "evidence", "explanation", "label", "segmentIndex", "segments", "state", "version",
    ]);
    expect(Object.keys(c.vehicleConfidence).sort()).toEqual([
      "ariaLabel", "evidence", "explanation", "findings", "gaps", "label", "segmentIndex", "segments", "state", "version",
    ]);
    expect(c.rulesStatus).toBe("proposed_not_approved");
  });

  it("a new private field on the assessment does not reach the public contract", () => {
    const a = assess() as MarketPassAssessment & { priceFairness: { secretFloorPrice?: number } };
    a.priceFairness.secretFloorPrice = 12345;
    expect(JSON.stringify(toPublicContract(a))).not.toContain("12345");
  });

  it("the recursive guard finds a forbidden key nested in arrays and refuses the contract", () => {
    expect(findForbiddenKey({ a: [{ b: { internal: 1 } }] })).toBe("$.a[0].b.internal");
    expect(() => assertPublicContractClean({ x: [{ blackbook: { retail: 1 } }] })).toThrow(PublicContractLeakError);
  });

  it("keeps retrieval time and provider observation time apart in public evidence", () => {
    const c = toPublicContract(assess());
    const price = c.priceFairness.evidence.find((e) => e.key === "asking_price")!;
    expect(price).toHaveProperty("retrievedAt");
    expect(price).toHaveProperty("observedAt");
    const comps = c.priceFairness.evidence.find((e) => e.key === "comparables")!;
    expect(comps.observedAt).toBeNull();
    expect(comps.retrievedAt).not.toBeNull();
  });

  it("the dealer contract carries the dealer-only indicators", () => {
    const d = toDealerContract(assess());
    expect(d.audience).toBe("dealer");
    expect(d.assessment.marketDesirability.score).toBe(80);
    expect(d.assessment.dataConfidence.score).toBe(24);
  });

  it("every indicator is versioned and the inputs hash ignores page views and the clock", () => {
    const a = assess();
    expect(a.priceFairness.version).toMatch(/proposed$/);
    expect(a.vehicleConfidence.version).toMatch(/proposed$/);
    expect(a.marketDesirability.version).toMatch(/proposed$/);
    expect(a.dataConfidence.version).toMatch(/proposed$/);
    const later = buildMarketPassAssessment({ row: { ...loadedRow(), view_count: 1 }, settings: settings(), nowMs: NOW + 3_600_000 });
    expect(later.inputsHash).toBe(a.inputsHash);
    expect(later.computedAt).not.toBe(a.computedAt);
    const repriced = assess({ ...loadedRow(), price: 30000 });
    expect(repriced.inputsHash).not.toBe(a.inputsHash);
  });
});

describe("the edge handler's authorization decision", () => {
  const anon: MarketPassCaller = { userId: null, memberTenantIds: [] };
  const member: MarketPassCaller = { userId: "user-1", memberTenantIds: [TENANT] };
  const outsider: MarketPassCaller = { userId: "user-2", memberTenantIds: [OTHER_TENANT] };
  const call = (caller: MarketPassCaller, audience: "public" | "dealer", row: MarketPassRow | null = loadedRow(), flag = true) =>
    decideMarketPassResponse({ row, settings: settings(flag), caller, audience, nowMs: NOW });

  it("anonymous callers get the public contract only", () => {
    const r = call(anon, "public");
    expect(r.status).toBe(200);
    expect((r.body as { audience: string }).audience).toBe("public");
    expect(call(anon, "dealer").status).toBe(401);
  });

  it("a member of another tenant asking for the dealer view gets 403 and no dealer data", () => {
    const r = call(outsider, "dealer");
    expect(r.status).toBe(403);
    const json = JSON.stringify(r.body);
    expect(json).not.toContain("marketDesirability");
    expect(json).not.toContain("dataConfidence");
    const pub = call(outsider, "public");
    expect(findForbiddenKey(pub.body)).toBeNull();
  });

  it("a member of the listing's tenant gets the dealer contract", () => {
    const r = call(member, "dealer");
    expect(r.status).toBe(200);
    expect((r.body as { audience: string }).audience).toBe("dealer");
  });

  it("the flag off for the tenant serves nothing", () => {
    expect(call(anon, "public", loadedRow(), false)).toEqual({ status: 404, body: { error: "marketpass_disabled" } });
    expect(call(member, "dealer", loadedRow(), false).status).toBe(404);
    expect(decideMarketPassResponse({ row: loadedRow(), settings: {}, caller: anon, audience: "public", nowMs: NOW }).status).toBe(404);
  });

  it("a tenant binding that is not the listing's tenant serves nothing", () => {
    const bound = (t: string) => decideMarketPassResponse({ row: loadedRow(), settings: settings(), caller: anon, audience: "public", nowMs: NOW, expectedTenantId: t });
    expect(bound(OTHER_TENANT)).toEqual({ status: 404, body: { error: "not_found" } });
    expect(bound(TENANT).status).toBe(200);
  });

  it("an unpublished listing is not found for the public, and a missing row is not found", () => {
    expect(call(anon, "public", { ...loadedRow(), status: "draft" }).status).toBe(404);
    expect(call(member, "dealer", { ...loadedRow(), status: "draft" }).status).toBe(200);
    expect(call(anon, "public", null).status).toBe(404);
  });
});
