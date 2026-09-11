// ── The engine knows what it knows, and says what it does not ──────────────

import { describe, it, expect } from "vitest";
import {
  buildAwarenessState, resolveIdentityField, AUTHORITATIVE_SOURCES,
  IDENTITY_STALE_DAYS, COHORT_DEFINING_DIMENSIONS, type AwarenessInput,
} from "./awareness.ts";
import {
  classifyEquipment, classifyEquipmentEntry, isMarketingCopy,
} from "./equipmentClass.ts";

const NOW = Date.parse("2026-09-11T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

describe("resolveIdentityField", () => {
  it("marks an authoritative source verified", () => {
    const f = resolveIdentityField(
      [{ value: "AWD", source: "window_sticker", timestamp: daysAgo(1) }], { now: NOW },
    );
    expect(f.status).toBe("verified");
    expect(f.normalized).toBe("awd");
    expect(f.source).toBe("window_sticker");
    expect(f.reasons).toContain("identity_from_window_sticker");
  });

  it("marks a feed-only value derived, not verified", () => {
    const f = resolveIdentityField([{ value: "AWD", source: "listing_feed" }], { now: NOW });
    expect(f.status).toBe("derived");
  });

  it("marks an absent value missing", () => {
    for (const claims of [[], [{ value: null }], [{ value: "  " }], [{ value: undefined }]]) {
      expect(resolveIdentityField(claims, { now: NOW }).status, JSON.stringify(claims)).toBe("missing");
    }
  });

  it("refuses to break a tie between two authoritative sources", () => {
    // The whole point: picking the higher-ranked one silently is how a FWD car
    // joins an AWD market.
    const f = resolveIdentityField([
      { value: "AWD", source: "window_sticker" },
      { value: "FWD", source: "build_sheet" },
    ], { now: NOW });
    expect(f.status).toBe("conflicting");
    expect(f.value).toBeNull();
    expect(f.reasons).toContain("identity_conflict_between_authoritative_sources");
    // Both are preserved so the conflict can be inspected.
    expect(f.candidates.map((c) => c.value).sort()).toEqual(["awd", "fwd"]);
  });

  it("lets an authoritative source outrank a feed without calling it a conflict", () => {
    const f = resolveIdentityField([
      { value: "AWD", source: "window_sticker" },
      { value: "FWD", source: "listing_feed" },
    ], { now: NOW });
    expect(f.status).toBe("verified");
    expect(f.normalized).toBe("awd");
    expect(f.reasons).toContain("identity_non_authoritative_source_disagrees");
  });

  it("conflicts when only weak sources disagree", () => {
    const f = resolveIdentityField([
      { value: "AWD", source: "listing_feed" },
      { value: "FWD", source: "derived" },
    ], { now: NOW });
    expect(f.status).toBe("conflicting");
    expect(f.reasons).toContain("identity_conflict_between_non_authoritative_sources");
  });

  it("marks an old source stale rather than verified", () => {
    const f = resolveIdentityField(
      [{ value: "AWD", source: "window_sticker", timestamp: daysAgo(IDENTITY_STALE_DAYS + 1) }],
      { now: NOW },
    );
    expect(f.status).toBe("stale");
    expect(f.reasons).toContain("identity_source_stale");
  });

  it("never accepts marketing copy as a value", () => {
    const f = resolveIdentityField([
      { value: "fully loaded", source: "listing_feed" },
      { value: "AWD", source: "marketing_description" },
    ], { now: NOW });
    expect(f.status).toBe("missing");
    expect(f.reasons).toContain("identity_marketing_copy_refused");
  });

  it("honours a source allow-list", () => {
    const f = resolveIdentityField(
      [{ value: "AWD", source: "listing_feed" }],
      { now: NOW, allowedSources: AUTHORITATIVE_SOURCES },
    );
    expect(f.status).toBe("missing");
    expect(f.reasons).toContain("identity_source_not_allowed_listing_feed");
  });
});

describe("equipment classification, from real feed shapes", () => {
  it("reads a factory option code as cohort-defining", () => {
    for (const code of ["M93", "B10", "E10", "N96", "B94", "SR", "L92"]) {
      const c = classifyEquipmentEntry(code);
      if (/^[A-Z]{1,2}[0-9]{2}$/.test(code)) {
        expect(c?.equipmentClass, code).toBe("cohort_defining");
        expect(c?.reason).toBe("equipment_factory_code");
      }
    }
  });

  it("reads a (PIO) entry as dealer-installed and descriptive", () => {
    const c = classifyEquipmentEntry("INFINITI Radiant Dark Illuminated Cargo Scuff Plates (PIO)");
    expect(c?.equipmentClass).toBe("descriptive");
    expect(c?.reason).toBe("equipment_dealer_installed");
  });

  it("reads a factory package as cohort-defining", () => {
    const c = classifyEquipmentEntry("Sensory Package");
    expect(c?.equipmentClass).toBe("cohort_defining");
    expect(c?.reason).toContain("package");
  });

  it("reads cosmetics as descriptive even without a PIO marker", () => {
    for (const cosmetic of ["Premium Paint", "Splash Guards", "Floor Mats", "Wheel Locks", "Window Tint"]) {
      expect(classifyEquipmentEntry(cosmetic)?.equipmentClass, cosmetic).toBe("descriptive");
    }
  });

  it("reads powertrain and drivetrain terms as cohort-defining", () => {
    for (const material of ["Hybrid Powertrain", "Tow Package", "Third Row Seating", "Turbo"]) {
      expect(classifyEquipmentEntry(material)?.equipmentClass, material).toBe("cohort_defining");
    }
  });

  it("separates the two classes on a real mixed list", () => {
    const c = classifyEquipment([
      "M93", "B10", "E10", "N96", "B94",
      "Cargo Package - Dark (PIO)", "Splash Guards", "Premium Paint",
      "INFINITI Radiant Dark Illuminated Cargo Scuff Plates (PIO)",
      "Black Roof Rail Cross Bars (PIO)",
    ]);
    expect(c.unknown).toBe(false);
    expect(c.cohortDefining).toEqual(["b10", "b94", "e10", "m93", "n96"]);
    // The PIO cargo package is dealer-installed and must NOT define a cohort,
    // even though it says "Package".
    expect(c.cohortDefining).not.toContain("cargo package - dark (pio)");
    expect(c.descriptive.length).toBe(5);
  });

  it("calls an absent or unreadable list unknown, never empty", () => {
    for (const v of [null, undefined, "loaded", {}, 42, []]) {
      expect(classifyEquipment(v).unknown, JSON.stringify(v)).toBe(true);
    }
  });

  it("distinguishes 'no material options' from 'nobody decoded it'", () => {
    const decodedButPlain = classifyEquipment(["Splash Guards", "Premium Paint"]);
    expect(decodedButPlain.unknown).toBe(false);
    expect(decodedButPlain.cohortDefining).toEqual([]);
  });

  it("refuses marketing phrases as equipment truth", () => {
    for (const phrase of ["Fully Loaded", "every option", "MUST SEE", "like new"]) {
      expect(isMarketingCopy(phrase), phrase).toBe(true);
    }
    expect(isMarketingCopy("Sensory Package")).toBe(false);
  });

  it("never infers an option from a sibling", () => {
    // Two same-trim cars, one decoded and one not. The undecoded one stays
    // unknown — there is no code path that borrows.
    const decoded = classifyEquipment(["M93", "B10"]);
    const undecoded = classifyEquipment(null);
    expect(decoded.cohortDefining).toHaveLength(2);
    expect(undecoded.cohortDefining).toHaveLength(0);
    expect(undecoded.unknown).toBe(true);
  });
});

describe("buildAwarenessState", () => {
  // Typed explicitly: without it TypeScript infers each claim's source as the
  // literal in the fixture, and a test that substitutes a different source
  // fails to compile rather than failing to pass.
  const base = (): AwarenessInput => ({
    claims: {
      year: [{ value: 2023, source: "build_sheet" }],
      make: [{ value: "INFINITI", source: "build_sheet" }],
      model: [{ value: "QX60", source: "build_sheet" }],
      trim: [{ value: "LUXE", source: "window_sticker" }],
      drivetrain: [{ value: "AWD", source: "build_sheet" }],
      powertrain: [{ value: "3.5L V6", source: "build_sheet" }],
      bodyType: [{ value: "SUV", source: "build_sheet" }],
      vehicleClass: [{ value: "cpo", source: "dealer_confirmed" }],
      certification: [{ value: "certified", source: "dealer_confirmed" }],
      mileage: [{ value: 30496, source: "listing_feed" }],
      zip: [{ value: "06120", source: "dealer_confirmed" }],
    },
    equipment: { entries: ["M93", "B10"], source: "build_sheet" },
    radiusMiles: 100,
    now: NOW,
  });

  it("knows every dimension when every source is present", () => {
    const a = buildAwarenessState(base());
    expect(a.unknown).toEqual([]);
    expect(a.conflicts).toEqual([]);
    expect(a.safeToCompare).toBe(true);
    expect(a.equipmentSignature).not.toBeNull();
    expect(a.reasons).toContain("awareness_safe_to_compare");
  });

  it("reports what it does not know, by name", () => {
    const input = base();
    delete (input.claims as Record<string, unknown>).trim;
    const a = buildAwarenessState(input);
    expect(a.unknown).toContain("trim");
    expect(a.reasons).toContain("trim_unknown");
  });

  it("becomes unsafe to compare on a cohort-dimension conflict", () => {
    const input = base();
    input.claims.drivetrain = [
      { value: "AWD", source: "window_sticker" },
      { value: "FWD", source: "build_sheet" },
    ];
    const a = buildAwarenessState(input);
    expect(a.conflicts).toContain("drivetrain");
    expect(a.safeToCompare).toBe(false);
    expect(a.reasons).toContain("drivetrain_conflict");
    expect(a.reasons).toContain("awareness_cohort_dimension_conflicted");
  });

  it("stays safe to compare when a NON-cohort dimension conflicts", () => {
    const input = base();
    input.claims.mileage = [
      { value: 30496, source: "window_sticker" },
      { value: 30500, source: "build_sheet" },
    ];
    const a = buildAwarenessState(input);
    expect(a.conflicts).toContain("mileage");
    expect(COHORT_DEFINING_DIMENSIONS).not.toContain("mileage");
    expect(a.safeToCompare).toBe(true);
  });

  it("refuses equipment from a non-authoritative source", () => {
    const input = base();
    input.equipment = { entries: ["M93", "B10"], source: "listing_feed" };
    const a = buildAwarenessState(input);
    expect(a.equipment.unknown).toBe(true);
    expect(a.equipmentSignature).toBeNull();
    expect(a.unknown).toContain("equipment");
    expect(a.equipment.reasons).toContain("equipment_source_listing_feed_not_authoritative");
  });

  it("records the market geography it would use", () => {
    const a = buildAwarenessState(base());
    expect(a.geography.zip).toBe("06120");
    expect(a.geography.radiusMiles).toBe(100);
    expect(a.geography.source).toBe("dealer_confirmed");
  });

  it("uses no probabilistic score anywhere", () => {
    const src = require("node:fs").readFileSync("src/lib/market/awareness.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const probabilistic of ["Math.random", "probability", "score", "percent", "weight", "0.5", "0.8"]) {
      expect(src, probabilistic).not.toContain(probabilistic);
    }
  });
});
