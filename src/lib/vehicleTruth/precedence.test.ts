import { describe, expect, it } from "vitest";
import {
  canProduceVerifiedFact,
  capConfidence,
  factAuthority,
  isVerified,
  precedenceFor,
  resolveFact,
  sourceRank,
  type CandidateFact,
} from "./precedence";

const c = <T>(
  factKey: string, value: T, source: Parameters<typeof sourceRank>[1],
  confidence: Parameters<typeof capConfidence>[1] = "VERIFIED",
  sourceTimestamp?: string,
): CandidateFact<T> => ({ factKey, value, source, confidence, sourceTimestamp });

describe("fact authority", () => {
  it("assigns dealer-controlled facts to the dealership", () => {
    for (const key of ["stock_number", "mileage", "advertised_price", "dealer_installed_equipment"]) {
      expect(factAuthority(key), key).toBe("dealer");
    }
  });

  it("assigns manufacturer-controlled facts to the manufacturer", () => {
    for (const key of [
      "base_msrp", "destination_charge", "total_msrp", "factory_option_price",
      "factory_package", "manufacturer", "drivetrain", "exterior_color_code",
    ]) {
      expect(factAuthority(key), key).toBe("manufacturer");
    }
  });

  it("treats an unknown fact as shared rather than guessing", () => {
    expect(factAuthority("some_new_field")).toBe("shared");
  });
});

describe("source precedence", () => {
  it("puts a dealer correction first on a dealer-controlled fact", () => {
    expect(precedenceFor("stock_number")[0]).toBe("dealer_confirmed");
    expect(sourceRank("mileage", "dealer_confirmed"))
      .toBeLessThan(sourceRank("mileage", "neovin"));
  });

  it("keeps a dealer correction below every provider on manufacturer facts", () => {
    // A dealer may not quietly rewrite the original MSRP.
    for (const provider of ["oem_authorized", "neovin", "marketcheck", "vin_decode"] as const) {
      expect(sourceRank("base_msrp", provider), provider)
        .toBeLessThan(sourceRank("base_msrp", "dealer_confirmed"));
    }
  });

  it("ranks AI inference last on every fact", () => {
    for (const key of ["base_msrp", "stock_number", "trim", "anything"]) {
      const order = precedenceFor(key);
      expect(order[order.length - 1], key).toBe("ai_inference");
    }
  });

  it("prefers manufacturer-issued data over every decode", () => {
    expect(precedenceFor("total_msrp")[0]).toBe("oem_authorized");
  });
});

describe("confidence ceilings", () => {
  it("never lets AI inference become a verified fact", () => {
    expect(capConfidence("ai_inference", "VERIFIED")).toBe("LOW");
    expect(isVerified("ai_inference", "VERIFIED")).toBe(false);
    expect(canProduceVerifiedFact("ai_inference")).toBe(false);
  });

  it("caps a VIN decode below verified", () => {
    expect(capConfidence("vin_decode", "VERIFIED")).toBe("MEDIUM");
    expect(canProduceVerifiedFact("vin_decode")).toBe(false);
  });

  it("lets the manufacturer, NeoVIN and a dealer confirmation verify", () => {
    for (const s of ["oem_authorized", "neovin", "dealer_confirmed"] as const) {
      expect(capConfidence(s, "VERIFIED"), s).toBe("VERIFIED");
      expect(canProduceVerifiedFact(s), s).toBe(true);
    }
  });

  it("never strengthens a weak claim", () => {
    expect(capConfidence("oem_authorized", "LOW")).toBe("LOW");
    expect(capConfidence("neovin", "MEDIUM")).toBe("MEDIUM");
  });
});

describe("resolving competing facts", () => {
  it("returns null with no candidates", () => {
    expect(resolveFact([])).toBeNull();
  });

  it("lets NeoVIN win over MarketCheck on a manufacturer fact", () => {
    const r = resolveFact([
      c("base_msrp", 47595, "neovin"),
      c("base_msrp", 47000, "marketcheck", "HIGH"),
    ]);
    expect(r?.value).toBe(47595);
    expect(r?.source).toBe("neovin");
    expect(r?.conflicting).toHaveLength(1);
  });

  it("lets the dealer win on their own stock number", () => {
    const r = resolveFact([
      c("stock_number", "MC-9931", "marketcheck", "HIGH"),
      c("stock_number", "IN12567", "dealer_confirmed"),
    ]);
    expect(r?.value).toBe("IN12567");
    expect(r?.source).toBe("dealer_confirmed");
  });

  it("does not let the dealer quietly rewrite the original MSRP", () => {
    const r = resolveFact([
      c("base_msrp", 82450, "neovin"),
      c("base_msrp", 79995, "dealer_confirmed"),
    ]);
    expect(r?.value).toBe(82450);
    expect(r?.source).toBe("neovin");
    // Both may verify and they disagree — a person decides, not the ranking.
    expect(r?.disputed).toBe(true);
  });

  it("marks agreement as undisputed even across sources", () => {
    const r = resolveFact([
      c("trim", "SENSORY AWD", "neovin"),
      c("trim", "SENSORY AWD", "marketcheck", "HIGH"),
    ]);
    expect(r?.disputed).toBe(false);
    expect(r?.conflicting).toEqual([]);
  });

  it("does not raise a dispute when only a weak source disagrees", () => {
    const r = resolveFact([
      c("trim", "SENSORY AWD", "neovin"),
      c("trim", "LUXE", "ai_inference", "VERIFIED"),
    ]);
    expect(r?.value).toBe("SENSORY AWD");
    expect(r?.disputed).toBe(false);
    expect(r?.conflicting).toHaveLength(1);
  });

  it("never lets AI inference win, even alongside nothing stronger on a shared fact", () => {
    const r = resolveFact([
      c("body_style", "SUV", "ai_inference", "VERIFIED"),
      c("body_style", "Wagon", "vin_decode", "MEDIUM"),
    ]);
    expect(r?.source).toBe("vin_decode");
    expect(r?.confidence).toBe("MEDIUM");
  });

  it("fills a gap from AI only when it is the sole candidate, and never as verified", () => {
    const r = resolveFact([c("body_style", "SUV", "ai_inference", "VERIFIED")]);
    expect(r?.value).toBe("SUV");
    expect(r?.confidence).toBe("LOW");
    expect(isVerified(r!.source, r!.confidence)).toBe(false);
  });

  it("breaks a same-rank tie on confidence, then on recency", () => {
    const r = resolveFact([
      c("mileage", 13500, "dealer_confirmed", "MEDIUM", "2026-07-01T00:00:00Z"),
      c("mileage", 13127, "dealer_confirmed", "VERIFIED", "2026-06-01T00:00:00Z"),
    ]);
    expect(r?.value).toBe(13127);

    const newer = resolveFact([
      c("mileage", 13500, "dealer_confirmed", "VERIFIED", "2026-07-01T00:00:00Z"),
      c("mileage", 13127, "dealer_confirmed", "VERIFIED", "2026-06-01T00:00:00Z"),
    ]);
    expect(newer?.value).toBe(13500);
  });
});
