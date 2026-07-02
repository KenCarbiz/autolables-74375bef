import { describe, it, expect } from "vitest";
import { runComplianceRedTeam, summarizeRedTeam, type RedTeamDraft } from "./complianceRedTeam";

// ──────────────────────────────────────────────────────────────
// Red-team: these cover the cross-cutting "what a regulator would
// flag" rules that sit above per-state validation. When a new
// banned phrase or audit rule is added, a regression here keeps
// the hard-blocks working on both the dealer and shopper paths.
// ──────────────────────────────────────────────────────────────

const baseDraft: RedTeamDraft = {
  state: "CA",
  vehiclePrice: 30000,
  docFeeAmount: 85,
  stickerText: "",
  products: [],
  spanishVersion: false,
};

describe("advertised price drift", () => {
  it("warns when the window price exceeds the advertised price by more than $50", () => {
    const findings = runComplianceRedTeam({ ...baseDraft, vehiclePrice: 31000, advertisedPrice: 30000 });
    const f = findings.find((x) => x.id === "advertised-price-drift");
    expect(f?.severity).toBe("warn");
  });
  it("does not warn within the $50 tolerance", () => {
    const findings = runComplianceRedTeam({ ...baseDraft, vehiclePrice: 30040, advertisedPrice: 30000 });
    expect(findings.find((x) => x.id === "advertised-price-drift")).toBeUndefined();
  });
  it("does not warn when no advertised price is on file", () => {
    const findings = runComplianceRedTeam({ ...baseDraft, vehiclePrice: 31000 });
    expect(findings.find((x) => x.id === "advertised-price-drift")).toBeUndefined();
  });
});

describe("banned phrases", () => {
  it("hard-FAILS on the vacated 'CARS Act' language", () => {
    const findings = runComplianceRedTeam({
      ...baseDraft,
      stickerText: "This addendum is CARS Act compliant.",
    });
    const hit = findings.find((f) => f.id === "banned-cars-act");
    expect(hit?.severity).toBe("fail");
    expect(hit?.citation).toMatch(/5th Circuit/);
  });

  it("hard-FAILS on 'CARS Rule'", () => {
    const findings = runComplianceRedTeam({
      ...baseDraft,
      stickerText: "Under the CARS Rule we must disclose all add-ons.",
    });
    expect(findings.find((f) => f.id === "banned-cars-rule")?.severity).toBe("fail");
  });

  it("WARNS-to-fail on 'federally required' (overbroad)", () => {
    const findings = runComplianceRedTeam({
      ...baseDraft,
      stickerText: "This product is federally required.",
    });
    expect(findings.find((f) => f.id === "banned-federally-required")?.severity).toBe("fail");
  });

  it("checks product disclosures, not just sticker text", () => {
    const findings = runComplianceRedTeam({
      ...baseDraft,
      products: [
        { id: "a", name: "X", price: 100, badge_type: "installed", disclosure: "CARS Act compliant product" },
      ],
    });
    expect(findings.find((f) => f.id === "banned-cars-act")?.severity).toBe("fail");
  });

  it("is silent when no banned phrase is present", () => {
    const findings = runComplianceRedTeam({
      ...baseDraft,
      stickerText: "All fees are disclosed below.",
    });
    expect(findings.find((f) => f.id?.startsWith("banned-"))).toBeUndefined();
  });
});

describe("unsigned installed products at sign time", () => {
  it("FAILS when installed products have no initials", () => {
    const findings = runComplianceRedTeam({
      ...baseDraft,
      signedAt: new Date().toISOString(),
      products: [
        { id: "p1", name: "VIN Etch", price: 299, badge_type: "installed" },
        { id: "p2", name: "Paint Protection", price: 999, badge_type: "installed" },
      ],
      initialsByProductId: {},
    });
    const fail = findings.find((f) => f.id === "unsigned-installed");
    expect(fail?.severity).toBe("fail");
    expect(fail?.message).toMatch(/2 installed/);
  });

  it("does not fire before sign time", () => {
    const findings = runComplianceRedTeam({
      ...baseDraft,
      products: [
        { id: "p1", name: "VIN Etch", price: 299, badge_type: "installed" },
      ],
      initialsByProductId: {},
    });
    expect(findings.find((f) => f.id === "unsigned-installed")).toBeUndefined();
  });

  it("PASSES when every installed product is initialed", () => {
    const findings = runComplianceRedTeam({
      ...baseDraft,
      signedAt: new Date().toISOString(),
      products: [
        { id: "p1", name: "VIN Etch", price: 299, badge_type: "installed" },
        { id: "p2", name: "Paint Protection", price: 999, badge_type: "installed" },
      ],
      initialsByProductId: { p1: "AB", p2: "AB" },
    });
    expect(findings.find((f) => f.id === "unsigned-installed")).toBeUndefined();
  });
});

describe("add-on ratio warning", () => {
  it("WARNS when add-ons exceed 20% of vehicle price", () => {
    const findings = runComplianceRedTeam({
      ...baseDraft,
      vehiclePrice: 10000,
      products: [
        { id: "p1", name: "X", price: 2500, badge_type: "installed" },
      ],
    });
    const w = findings.find((f) => f.id === "addon-ratio-high");
    expect(w?.severity).toBe("warn");
    expect(w?.message).toMatch(/25%/);
  });

  it("is silent at exactly 20%", () => {
    const findings = runComplianceRedTeam({
      ...baseDraft,
      vehiclePrice: 10000,
      products: [{ id: "p1", name: "X", price: 2000, badge_type: "installed" }],
    });
    expect(findings.find((f) => f.id === "addon-ratio-high")).toBeUndefined();
  });
});

describe("E-SIGN consent enforcement", () => {
  it("FAILS when consent wasn't accepted before signing", () => {
    const findings = runComplianceRedTeam({
      ...baseDraft,
      signedAt: new Date().toISOString(),
      customerName: "Jane Buyer",
      esignConsentAccepted: false,
    });
    expect(findings.find((f) => f.id === "esign-consent-missing")?.severity).toBe("fail");
  });

  it("does not fire before sign time", () => {
    const findings = runComplianceRedTeam({
      ...baseDraft,
      esignConsentAccepted: false,
    });
    expect(findings.find((f) => f.id === "esign-consent-missing")).toBeUndefined();
  });
});

describe("customer name required at sign time", () => {
  it("FAILS when signing with a blank name", () => {
    const findings = runComplianceRedTeam({
      ...baseDraft,
      signedAt: new Date().toISOString(),
      customerName: "",
    });
    expect(findings.find((f) => f.id === "customer-name-blank")?.severity).toBe("fail");
  });
});

describe("FTC Buyers Guide requirement for used", () => {
  it("FAILS a used-car deal with no Buyers Guide attached", () => {
    const findings = runComplianceRedTeam({
      ...baseDraft,
      vehicleCondition: "used",
      buyersGuideAttached: false,
    });
    expect(findings.find((f) => f.id === "buyers-guide-missing")?.severity).toBe("fail");
  });

  it("is silent on new cars", () => {
    const findings = runComplianceRedTeam({
      ...baseDraft,
      vehicleCondition: "new",
      buyersGuideAttached: false,
    });
    expect(findings.find((f) => f.id === "buyers-guide-missing")).toBeUndefined();
  });
});

describe("pre-installed products require a verified install proof", () => {
  it("FAILS a pre-installed product with no verified proof on file", () => {
    const findings = runComplianceRedTeam({
      ...baseDraft,
      products: [{ id: "p1", name: "Ceramic Coating", price: 999, badge_type: "installed" }],
      provenInstallProofs: [],
    });
    const f = findings.find((x) => x.id === "installed-without-verified-proof");
    expect(f?.severity).toBe("fail");
    expect(f?.message).toMatch(/1 pre-installed/);
  });

  it("PASSES when a verified proof matches the product name", () => {
    const findings = runComplianceRedTeam({
      ...baseDraft,
      products: [{ id: "p1", name: "Ceramic Coating", price: 999, badge_type: "installed" }],
      provenInstallProofs: [{ product_name: "Ceramic Coating", verified: true }],
    });
    expect(findings.find((x) => x.id === "installed-without-verified-proof")).toBeUndefined();
  });

  it("still FAILS when a matching proof exists but is unverified (no photo/signature)", () => {
    const findings = runComplianceRedTeam({
      ...baseDraft,
      products: [{ id: "p1", name: "Ceramic Coating", price: 999, badge_type: "installed" }],
      provenInstallProofs: [{ product_name: "Ceramic Coating", verified: false }],
    });
    expect(findings.find((x) => x.id === "installed-without-verified-proof")?.severity).toBe("fail");
  });

  it("does not apply to customer-elected (optional) lines", () => {
    const findings = runComplianceRedTeam({
      ...baseDraft,
      products: [{ id: "p1", name: "Ceramic Coating", price: 999, badge_type: "optional" }],
      provenInstallProofs: [],
    });
    expect(findings.find((x) => x.id === "installed-without-verified-proof")).toBeUndefined();
  });

  it("does not run on the customer-side surfaces (no proof data supplied)", () => {
    const findings = runComplianceRedTeam({
      ...baseDraft,
      products: [{ id: "p1", name: "Ceramic Coating", price: 999, badge_type: "installed" }],
    });
    expect(findings.find((x) => x.id === "installed-without-verified-proof")).toBeUndefined();
  });
});

describe("doc fee over state cap", () => {
  it("hard-FAILS a fee above the state's statutory cap", () => {
    const findings = runComplianceRedTeam({ ...baseDraft, state: "CA", docFeeAmount: 499 });
    const f = findings.find((x) => x.id === "doc-fee-over-cap");
    expect(f?.severity).toBe("fail");
    expect(f?.message).toMatch(/\$85/);
  });

  it("is silent at exactly the cap", () => {
    const findings = runComplianceRedTeam({ ...baseDraft, state: "CA", docFeeAmount: 85 });
    expect(findings.find((x) => x.id === "doc-fee-over-cap")).toBeUndefined();
  });

  it("is silent in a no-cap state", () => {
    const findings = runComplianceRedTeam({ ...baseDraft, state: "CT", docFeeAmount: 999 });
    expect(findings.find((x) => x.id === "doc-fee-over-cap")).toBeUndefined();
  });
});

describe("summarizeRedTeam blocker flag", () => {
  it("sets blocker=true when any fail is present", () => {
    const findings = runComplianceRedTeam({
      ...baseDraft,
      stickerText: "CARS Act compliant",
    });
    const summary = summarizeRedTeam(findings);
    expect(summary.blocker).toBe(true);
    expect(summary.fail).toBeGreaterThan(0);
  });

  it("sets blocker=false when only warns are present", () => {
    const findings = runComplianceRedTeam({
      ...baseDraft,
      docFeeAmount: 0,
    });
    const summary = summarizeRedTeam(findings);
    expect(summary.blocker).toBe(false);
    expect(summary.warn).toBeGreaterThan(0);
  });
});
