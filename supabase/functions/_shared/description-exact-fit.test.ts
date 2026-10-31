import { describe, it, expect } from "vitest";
import {
  fitExact, wireText, countText, eligibleFacts, fitNarrativeExact, splitSentences, asciiPunctuation,
  disclosureDecision, DescriptionFitError, type WireProfile,
} from "./description-exact-fit.ts";
import { resolveChannelPolicy, checkChannelPolicy, GLOBAL_PROHIBITED_PHRASES } from "./description-channel-policy.ts";

const profile: WireProfile = { exactTotal: 3921, localMax: 4000, singleLine: true, asciiOnly: true, countUnit: "codePoints" };
const disclosure = { text: "Demo disclosure.", version: "fixture-1", approved: true };
const candidate = (n: number) => [{ id: "identity", required: true, variants: [{ text: "A".repeat(n) }] }];
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as DescriptionFitError).code; } return null; };

describe("kit reference behavior (ported from engine.test.mjs)", () => {
  it("lands exactly 3921 including disclosure and joining space", () => {
    const r = fitExact({ sections: candidate(3921 - disclosure.text.length - 1), disclosure, profile });
    expect(r.counts).toEqual({ codePoints: 3921, utf16: 3921, utf8Bytes: 3921 });
    expect(r.text.endsWith(disclosure.text)).toBe(true);
  });
  it("does not pad or truncate", () => {
    expect(code(() => fitExact({ sections: candidate(3000), disclosure, profile }))).toBe("EXACT_LENGTH_UNREACHABLE");
  });
  it("does not normalize an approved disclosure", () => {
    expect(code(() => fitExact({ sections: candidate(3904), disclosure: { ...disclosure, text: "Demo  disclosure." }, profile })))
      .toBe("DISCLOSURE_NORMALIZATION");
  });
  it("selects the most useful candidate at equal length", () => {
    const r = fitExact({ sections: [{ id: "x", required: true, variants: [{ text: "Hello", utility: 1 }, { text: "World", utility: 5 }] }],
      disclosure: { text: "", approved: true, version: "none" }, profile: { ...profile, exactTotal: 5 } });
    expect(r.text).toBe("World");
  });
  it("omits optional sections without phantom separators", () => {
    const r = fitExact({ sections: [{ id: "a", required: true, variants: [{ text: "Hello" }] }, { id: "b", variants: [{ text: "" }, { text: "all" }] }],
      disclosure: { text: "", approved: true, version: "none" }, profile: { ...profile, exactTotal: 5 } });
    expect(r.text).toBe("Hello");
  });
  it("rejects an empty mandatory section", () => {
    expect(code(() => fitExact({ sections: [{ id: "a", required: true, variants: [{ text: "" }] }], disclosure, profile }))).toBe("REQUIRED_SECTION_EMPTY");
  });
  it("rejects unicode for vAuto but keeps it for the website", () => {
    expect(code(() => wireText("INFINITI®", profile))).toBe("NON_ASCII_REVIEW");
    expect(wireText("INFINITI®", { singleLine: false })).toBe("INFINITI®");
    expect(countText("\u{1F697}")).toEqual({ codePoints: 1, utf16: 2, utf8Bytes: 4 });
  });
  it("rejects zero-width padding and markup", () => {
    expect(code(() => wireText("a​b", profile))).toBe("INVISIBLE_CHARACTERS");
    expect(code(() => wireText("<b>car</b>", profile))).toBe("MARKUP_NOT_ALLOWED");
  });
  it("flattens line endings before counting", () => {
    expect(wireText("A\r\n\r\nB", profile)).toBe("A B");
  });
  it("requires the exact target to fit the cap", () => {
    expect(code(() => fitExact({ sections: candidate(3921), disclosure, profile: { ...profile, localMax: 3000 } }))).toBe("INVALID_TARGET");
  });
  it("filters facts by scope, installation and freshness", () => {
    const scope = { vehicleId: "v1", storeId: "s1", marketContextId: "m1" };
    const base = { id: "good", source: "neovin", status: "verified", kind: "vehicle", vehicleId: "v1", observedAt: "2026-10-01T00:00:00Z" };
    const facts = [base, { ...base, id: "wrong", vehicleId: "v2" }, { ...base, id: "optional", equipment: true, installationStatus: "available_option" },
      { ...base, id: "stale", dynamic: true, expiresAt: "2026-10-02T00:00:00Z" }, { ...base, id: "unknown", status: "probable" },
      { ...base, id: "conflict", conflict: true }, { ...base, id: "undated", observedAt: undefined }, { ...base, id: "dynamic-undated", dynamic: true }];
    expect(eligibleFacts(facts, scope, Date.parse("2026-10-31T00:00:00Z")).map((f) => f.id)).toEqual(["good"]);
  });
});

// A realistic sentence pool: ~45 sentences of varied length, as a writer drafts.
// Deterministic but irregular lengths, the way real prose varies.
const WORDS = ["heated", "front", "seats", "with", "a", "power", "moonroof", "adaptive", "cruise", "control", "and", "wireless", "charging", "pad", "for", "the", "driver"];
const sentence = (i: number) => {
  const n = 9 + ((i * 7) % 11);
  return `Item ${i} adds ` + Array.from({ length: n }, (_, k) => WORDS[(i * 3 + k * 5) % WORDS.length]).join(" ") + ".";
};
const pool = (n: number) => ["This 2024 Honda Civic EX is offered by Harte Infiniti in Hartford, CT.", ...Array.from({ length: n }, (_, i) => sentence(i + 1))].join(" ");
const legal = "Price excludes tax, title and registration. See dealer for details.";

describe("fitNarrativeExact", () => {
  it("lands exactly 3921 with CTA and disclosure, keeping identity first", () => {
    const fit = fitNarrativeExact({ narrative: pool(45), cta: "Contact Harte Infiniti to schedule a test drive.",
      disclosure: { text: legal, version: "d1", approved: true }, profile });
    expect(fit.ok).toBe(true);
    expect([...fit.text!].length).toBe(3921);
    expect(fit.text!.startsWith("This 2024 Honda Civic EX")).toBe(true);
    expect(fit.text!.endsWith(`Contact Harte Infiniti to schedule a test drive. ${legal}`)).toBe(true);
    expect(fit.text).not.toMatch(/\s{2}|\n/);
    expect(fit.meta.counterVersion).toBe("exact_fit_1");
  });
  it("holds for review rather than padding a thin draft", () => {
    const fit = fitNarrativeExact({ narrative: pool(5), cta: null, disclosure: { text: legal, version: "d1", approved: true }, profile });
    expect(fit.ok).toBe(false);
    expect(fit.code).toBe("EXACT_LENGTH_UNREACHABLE");
    expect(fit.text).toBeNull();
  });
  it("does not count a disclosure the writer restated", () => {
    const fit = fitNarrativeExact({ narrative: `${pool(45)} ${legal}`, cta: null, disclosure: { text: legal, version: "d1", approved: true }, profile });
    expect(fit.ok).toBe(true);
    expect(fit.text!.split(legal).length - 1).toBe(1);
  });
  it("blocks a disclosure that is not already wire-format ASCII", () => {
    const fit = fitNarrativeExact({ narrative: pool(45), cta: null,
      disclosure: { text: "Price excludes the $895 conveyance fee — see dealer.", version: "d1", approved: true }, profile });
    expect(fit.ok).toBe(false);
    expect(fit.code).toBe("NON_ASCII_REVIEW");
  });
  it("maps typographic punctuation in the draft narrative only", () => {
    expect(asciiPunctuation("Driver’s seat — heated")).toBe("Driver's seat - heated");
    expect(splitSentences("It has a 2.0L engine. It is AWD.")).toEqual(["It has a 2.0L engine.", "It is AWD."]);
  });
  it("versions the disclosure by content", async () => {
    const a = await disclosureDecision({ required_legal_text: legal });
    const b = await disclosureDecision({ required_legal_text: legal + " " });
    const c = await disclosureDecision({ required_legal_text: "Different." });
    expect(a.version).toBe(b.version);
    expect(a.version).not.toBe(c.version);
  });
});

describe("DriveSignal channel policies", () => {
  it("vAuto is an exact 3,921 export under a 4,000 cap", () => {
    const v = resolveChannelPolicy("vauto")!;
    expect(v.exactTotal).toBe(3921);
    expect(v.characterLimit).toBe(4000);
    expect(v.singleLine && v.asciiOnly).toBe(true);
    expect(v.deliveryMode).toBe("export_only");
  });
  it("a tenant cannot override the exact target", () => {
    expect(resolveChannelPolicy("vauto", { exactTotal: 4000 })!.exactTotal).toBe(3921);
  });
  it("flags any total other than exactly 3,921", () => {
    const v = resolveChannelPolicy("vauto")!;
    expect(checkChannelPolicy("x".repeat(3920), v).some((f) => f.code === "EXACT_LENGTH_MISMATCH" && f.severity === "blocking")).toBe(true);
    expect(checkChannelPolicy("x".repeat(3921), v).some((f) => f.code === "EXACT_LENGTH_MISMATCH")).toBe(false);
  });
  it("the website is primary with a local 6,500 guardrail and no exact target", () => {
    const w = resolveChannelPolicy("dealer_website")!;
    expect(w.exactTotal ?? null).toBeNull();
    expect(w.characterLimit).toBe(6500);
    expect(w.limitVerified).toBe(false);
  });
  it("every destination carries the global prohibited phrases", () => {
    for (const key of ["vehicle_passport", "dealer_website", "cargurus", "vauto"]) {
      const p = resolveChannelPolicy(key)!;
      for (const phrase of GLOBAL_PROHIBITED_PHRASES) expect(p.prohibitedPhrases).toContain(phrase);
    }
    expect(checkChannelPolicy("This car is accident free.", resolveChannelPolicy("dealer_website")!)
      .some((f) => f.code === "CHANNEL_PROHIBITED_PHRASE")).toBe(true);
  });
});
