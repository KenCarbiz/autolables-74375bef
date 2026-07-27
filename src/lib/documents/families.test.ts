import { describe, expect, it } from "vitest";
import {
  applicableFamilies,
  classifyCondition,
  DOCUMENT_FAMILIES,
  DOCUMENT_FAMILY_IDS,
  familyForDocumentType,
  satisfiesRequirement,
  type DocumentFamilyId,
} from "./families";

const byId = (id: DocumentFamilyId) => DOCUMENT_FAMILIES[id];

describe("document family taxonomy", () => {
  it("keeps five distinct families with distinct document types", () => {
    expect(DOCUMENT_FAMILY_IDS.length).toBe(5);
    const types = DOCUMENT_FAMILY_IDS.map((id) => byId(id).documentType);
    expect(new Set(types).size).toBe(5);
    // No family is stored as a generic "window_sticker".
    expect(types).not.toContain("window_sticker");
  });

  it("gives every family its own permission namespace and studio", () => {
    const prefixes = DOCUMENT_FAMILY_IDS.map((id) => byId(id).permissionPrefix);
    // The two addendum families intentionally share one permission set.
    expect(new Set(prefixes).size).toBe(4);
    for (const id of DOCUMENT_FAMILY_IDS) {
      expect(byId(id).studioRoute, id).toMatch(/^\//);
      expect(byId(id).adminTitle, id).toBeTruthy();
      expect(byId(id).customerTitle, id).toBeTruthy();
    }
  });

  it("names the Buyers Guide correctly and keeps 'warranty sticker' an alias only", () => {
    const g = byId("ftc_buyers_guide");
    expect(g.adminTitle).toBe("FTC Buyers Guide");
    expect(g.customerTitle).toBe("FTC Buyers Guide");
    expect(g.aliases).toContain("warranty sticker");
    expect(g.adminTitle.toLowerCase()).not.toContain("warranty sticker");
  });

  it("requires the reproduction disclosure and forbids dealer content on the OEM family", () => {
    const oem = byId("oem_window_sticker_reproduction");
    expect(oem.disclosure).toContain("Not an original manufacturer-issued Monroney label");
    for (const banned of [
      "dealer doc fee", "market adjustment", "ceramic coating", "VIN etch",
      "rebates", "dealer markup", "FTC warranty-selection language",
    ]) {
      expect(oem.prohibited, banned).toContain(banned);
    }
  });

  it("keeps the Passport QR off the Buyers Guide until compliance approves it", () => {
    expect(byId("ftc_buyers_guide").passportQrAllowed).toBe(false);
    for (const id of DOCUMENT_FAMILY_IDS.filter((x) => x !== "ftc_buyers_guide")) {
      expect(byId(id).passportQrAllowed, id).toBe(true);
    }
  });
});

describe("applicability by condition", () => {
  const map = (condition: string) =>
    Object.fromEntries(applicableFamilies(condition).map((a) => [a.family, a.applicability]));

  it("gives a new vehicle the OEM sticker and new-vehicle addendum only", () => {
    expect(map("new")).toEqual({
      oem_window_sticker_reproduction: "eligible",
      new_vehicle_addendum: "eligible",
      used_vehicle_addendum: "not_applicable",
      ftc_buyers_guide: "not_applicable",
      used_vehicle_window_sticker: "not_applicable",
    });
  });

  it("requires the Buyers Guide on a used vehicle and keeps the OEM sticker supplemental", () => {
    for (const condition of ["used", "pre-owned", "certified pre-owned"]) {
      const m = map(condition);
      expect(m.ftc_buyers_guide, condition).toBe("required");
      expect(m.oem_window_sticker_reproduction, condition).toBe("supplemental");
      expect(m.used_vehicle_addendum, condition).toBe("eligible");
      expect(m.used_vehicle_window_sticker, condition).toBe("eligible");
      expect(m.new_vehicle_addendum, condition).toBe("not_applicable");
    }
  });

  it("decides nothing when the condition is unresolved", () => {
    for (const a of applicableFamilies("clean one owner")) {
      expect(a.applicability).toBe("not_applicable");
      expect(a.reason).toContain("unresolved");
    }
    expect(classifyCondition(null)).toBe("unknown");
  });

  it("explains why the OEM reproduction is only supplemental on a used vehicle", () => {
    const oem = applicableFamilies("used").find((a) => a.family === "oem_window_sticker_reproduction");
    expect(oem?.reason).toContain("never replaces a required used-vehicle disclosure");
  });
});

describe("legacy document type resolution", () => {
  it("maps stored legacy types onto their families", () => {
    expect(familyForDocumentType("factory_sticker")?.id).toBe("oem_window_sticker_reproduction");
    expect(familyForDocumentType("buyers_guide")?.id).toBe("ftc_buyers_guide");
    expect(familyForDocumentType("window")?.id).toBe("used_vehicle_window_sticker");
  });

  it("splits the ambiguous legacy addendum type by vehicle condition", () => {
    expect(familyForDocumentType("addendum", "new")?.id).toBe("new_vehicle_addendum");
    expect(familyForDocumentType("addendum", "used")?.id).toBe("used_vehicle_addendum");
    expect(familyForDocumentType("addendum", "cpo")?.id).toBe("used_vehicle_addendum");
    // With no condition it must not guess "new".
    expect(familyForDocumentType("addendum")?.id).toBe("used_vehicle_addendum");
  });

  it("resolves the current types directly", () => {
    for (const id of DOCUMENT_FAMILY_IDS) {
      expect(familyForDocumentType(DOCUMENT_FAMILIES[id].documentType)?.id, id).toBe(id);
    }
  });

  it("returns nothing for an unknown type rather than a default", () => {
    expect(familyForDocumentType("mystery")).toBeNull();
    expect(familyForDocumentType("")).toBeNull();
    expect(familyForDocumentType(null)).toBeNull();
  });
});

describe("requirement satisfaction", () => {
  it("never lets one family satisfy another", () => {
    for (const a of DOCUMENT_FAMILY_IDS) {
      for (const b of DOCUMENT_FAMILY_IDS) {
        expect(satisfiesRequirement(a, b), `${a} by ${b}`).toBe(a === b);
      }
    }
  });

  it("specifically refuses an OEM reproduction as a Buyers Guide", () => {
    expect(satisfiesRequirement("ftc_buyers_guide", "oem_window_sticker_reproduction")).toBe(false);
    expect(satisfiesRequirement("ftc_buyers_guide", "used_vehicle_window_sticker")).toBe(false);
  });
});
