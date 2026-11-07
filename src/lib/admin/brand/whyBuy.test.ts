import { describe, it, expect } from "vitest";
import { buildWhyBuyPatch, readWhyBuy, validateWhyBuy, formatReviewLine, EMPTY_REPUTATION } from "./whyBuy";

const settings = (over: Record<string, unknown> = {}) => ({
  dealer_tagline: "", why_buy_here: "", warranty_programs: "", dealer_years_in_business: "", dealer_family_owned: "", dealer_storefront_url: "",
  dealer_satisfaction: "", dealer_google_rating: "", dealer_google_count: "", dealer_bbb_rating: "", dealer_service_location: "", dealer_service_address: "",
  dealer_delivery: "", dealer_financing: "", dealer_advisor_name: "", dealer_advisor_title: "", dealer_advisor_photo: "", dealer_advisor_response: "",
  dealer_review_sources: "", dealer_certifications: "", dealer_amenities: "", dealer_services: "", iihs_awards_enabled: false, iihs_awards: [], why_buy_profile: null, ...over,
}) as never;

describe("why buy adapter", () => {
  it("reads legacy flat strings with no dates and never invents any", () => {
    const d = readWhyBuy(settings({ dealer_review_sources: "Google | 4.9 | Nice\nEdmunds | | ", dealer_certifications: "A, B", dealer_amenities: "Lounge, Cafe" }));
    expect(d.reviews.map((r) => [r.source, r.rating, r.quote, r.asOf])).toEqual([["Google", "4.9", "Nice", ""], ["Edmunds", "", "", ""]]);
    expect(d.awards.map((a) => a.name)).toEqual(["A", "B"]);
    expect(d.amenities).toEqual(["Lounge", "Cafe"]);
    expect(d.reputation).toEqual(EMPTY_REPUTATION);
  });

  it("projects back into the exact strings the Passport parser reads", () => {
    const base = readWhyBuy(settings());
    const draft = { ...base, reviews: [{ id: "r1", source: "Google", rating: "4.9", quote: "Great\nplace", asOf: "2026-10-01" }], awards: [{ id: "a1", name: "Award", issuer: "Maker" }], services: ["Express", "Loaner"] };
    const patch = buildWhyBuyPatch(draft, base);
    expect(patch.dealer_review_sources).toBe("Google | 4.9 | Great place");
    expect(patch.dealer_certifications).toBe("Award");
    expect(patch.dealer_services).toBe("Express, Loaner");
    expect((patch.why_buy_profile as { reviews: { asOf: string }[] }).reviews[0].asOf).toBe("2026-10-01");
    const [name, rating, ...rest] = formatReviewLine(draft.reviews[0]).split("|").map((p) => p.trim());
    expect([name, Number(rating), rest.join(" | ")]).toEqual(["Google", 4.9, "Great place"]);
  });

  it("keeps stored dates when the flat strings still match, and drops them when another editor changed the text", () => {
    const profile = { version: 1, reviews: [{ id: "x", source: "Google", rating: "4.9", quote: "Nice", asOf: "2026-10-01" }], awards: [], reputation: EMPTY_REPUTATION };
    expect(readWhyBuy(settings({ dealer_review_sources: "Google | 4.9 | Nice", why_buy_profile: profile })).reviews[0]).toMatchObject({ id: "x", asOf: "2026-10-01" });
    expect(readWhyBuy(settings({ dealer_review_sources: "Google | 4.7 | Nice", why_buy_profile: profile })).reviews[0].asOf).toBe("");
  });

  it("writes nothing when nothing changed", () => {
    const base = readWhyBuy(settings({ dealer_services: "A" }));
    expect(buildWhyBuyPatch(base, base)).toEqual({});
  });

  it("requires a date for a new rating but does not block untouched legacy values", () => {
    const base = readWhyBuy(settings({ dealer_google_rating: "4.8", dealer_review_sources: "Google | 4.9 | Nice" }));
    expect(Object.keys(validateWhyBuy(base, base, "2026-11-07").top)).toEqual([]);
    expect(Object.keys(validateWhyBuy(base, base, "2026-11-07").reviews)).toEqual([]);
    const edited = { ...base, dealer_google_rating: "4.7" };
    expect(validateWhyBuy(edited, base, "2026-11-07").top.googleAsOf).toBeTruthy();
    const added = { ...base, reviews: [...base.reviews, { id: "n", source: "Edmunds", rating: "4", quote: "", asOf: "" }] };
    expect(validateWhyBuy(added, base, "2026-11-07").reviews.n).toBeTruthy();
    expect(validateWhyBuy({ ...edited, reputation: { ...edited.reputation, googleAsOf: "2026-12-01" } }, base, "2026-11-07").top.googleAsOf).toMatch(/future/);
  });

  it("rejects out of range ratings and a satisfaction figure without a source", () => {
    const base = readWhyBuy(settings());
    const e = validateWhyBuy({ ...base, dealer_google_rating: "9", dealer_satisfaction: "98%" }, base, "2026-11-07");
    expect(e.top.dealer_google_rating).toBeTruthy();
    expect(e.top.satisfactionSource).toBeTruthy();
  });
});
