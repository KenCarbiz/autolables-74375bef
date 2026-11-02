import { describe, expect, it } from "vitest";
import { decideDrivetrain, isRatingMetadata, splitRatingMetadata } from "./sourceCorrections";
import { resolveReferenceVariant } from "./referenceVariants";

const base = { year: 2026, make: "INFINITI", model: "QX60", trim: "SPORT", source: "4WD" };

describe("recorded drivetrain corrections", () => {
  it("prints AWD for a 2026 QX60 SPORT whose feed says 4WD, keeping the source value and the manufacturer evidence", () => {
    const d = decideDrivetrain(base);
    expect(d.value).toBe("AWD");
    expect(d.sourceValue).toBe("4WD");
    expect(d.ruleId).toBe("infiniti-qx60-2026-awd-only-grades");
    expect(d.evidence?.url).toContain("infinitinews.com");
    expect(d.evidence?.quote).toMatch(/exclusively with Intelligent All-Wheel Drive/);
  });

  it("covers AUTOGRAPH and the long-form source spelling", () => {
    expect(decideDrivetrain({ ...base, trim: "Autograph", source: "Four Wheel Drive" }).value).toBe("AWD");
  });

  it("does not touch grades the manufacturer also sells with front-wheel drive", () => {
    for (const trim of ["PURE", "LUXE", "Luxe AWD", null]) {
      const d = decideDrivetrain({ ...base, trim });
      expect(d.value).toBe("4WD");
      expect(d.ruleId).toBeNull();
    }
  });

  it("is not a blanket 4WD = AWD equivalence", () => {
    expect(decideDrivetrain({ ...base, year: 2027 }).value).toBe("4WD");
    expect(decideDrivetrain({ ...base, model: "QX80" }).value).toBe("4WD");
    expect(decideDrivetrain({ ...base, make: "NISSAN", model: "PATHFINDER" }).value).toBe("4WD");
    expect(decideDrivetrain({ ...base, trim: "SPORT AUTOGRAPH" }).ruleId).toBeNull();
  });

  it("never invents a drivetrain and leaves other source values alone", () => {
    expect(decideDrivetrain({ ...base, source: null }).value).toBeNull();
    expect(decideDrivetrain({ ...base, source: "FWD" }).value).toBe("FWD");
    expect(decideDrivetrain({ ...base, source: "AWD" }).ruleId).toBeNull();
  });

  it("the corrected value now resolves the dedicated 2026 QX60 SPORT AWD layout", () => {
    const corrected = decideDrivetrain(base).value;
    const asIs = resolveReferenceVariant({ make: "INFINITI", modelYear: 2026, model: "QX60", trim: "SPORT", drivetrain: "4WD", fuelType: "Premium" });
    const fixed = resolveReferenceVariant({ make: "INFINITI", modelYear: 2026, model: "QX60", trim: "SPORT", drivetrain: corrected, fuelType: "Premium" });
    expect(asIs.status).not.toBe("matched");
    expect(fixed.status).toBe("matched");
  });
});

describe("decoder rating metadata is not equipment", () => {
  it("recognises the NeoVIN crash-rating rows", () => {
    for (const s of ["Standard-NHTSA", "Overall-5", "Side Impact-5", "Rollover Rating-4", "Frontal Crash Rating-4", "NHTSA", "Standard IIHS",
      "Standard-IIHS", "Side Impact-Good", "Moderate Overlap Front Test-Good", "Small Overlap Front - Driver-Good", "Small Overlap Front - Passenger-Good",
      "Test Revision-Updated", "Headlights-Good", "Latch-Good", "Seat Belt Reminder-Good"]) {
      expect(isRatingMetadata(s)).toBe(true);
    }
  });

  it("keeps real equipment that mentions the same words", () => {
    for (const s of ["Side Impact Beams", "Rollover Sensor", "Overall Length", "Remote Engine Starter", "Side Impact Airbags-Front", "LED Headlights-Low Beam", "Headlights", "Front Seat belts Pre-Tensioners", "Latch Preparation"]) {
      expect(isRatingMetadata(s)).toBe(false);
    }
  });

  it("splits them out of the standard list without dropping anything else", () => {
    const r = splitRatingMetadata({ STANDARD: ["Heated Seats", "Standard-NHTSA", "Overall-5", "Side Impact-5", "AWD"], SAFETY: ["Overall-5"] });
    expect(r.equipment).toEqual({ STANDARD: ["Heated Seats", "AWD"] });
    expect(r.ratingMetadata).toEqual(["Standard-NHTSA", "Overall-5", "Side Impact-5", "Overall-5"]);
  });
});
