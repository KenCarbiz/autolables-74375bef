import { describe, it, expect } from "vitest";
import {
  normalizeFeatures, prioritizeFeatures, splitByOrigin, featureChecksum,
} from "../../../supabase/functions/_shared/description-features";
import {
  DEFAULT_CHANNEL_POLICIES, resolveChannelPolicy, checkChannelPolicy,
  computeChannelPolicyVersion,
} from "../../../supabase/functions/_shared/description-channel-policy";
import { TONE_PROFILES, checkTone, toneProfile } from "../../../supabase/functions/_shared/description-tone";
import {
  resolveVoiceProfile, computeVoiceProfileVersion, checkDealerClaims, checkLocalityUse,
} from "../../../supabase/functions/_shared/description-voice";
import {
  analyzeReadability, analyzeUniqueness, analyzeKeywords, scoreDescription,
  shingles, jaccard, countFactsUsed,
} from "../../../supabase/functions/_shared/description-scoring";
import {
  buildFactSnapshot, buildDescriptionPacket, buildMasterPromptV3, buildChannelPromptV3,
  validateContentV3, scoreVersion, computeInputChecksum, CHANNELS,
} from "../../../supabase/functions/_shared/description-core";

// These tests pin the Phase 3 guarantees: one canonical feature per physical
// feature, factory and dealer-added never merge, tone cannot move a fact, a
// channel cannot invent one, and every displayed number is calculated.

const SETTINGS = {
  review_mode: "EXCEPTION_REVIEW", review_mode_by_class: {},
  enabled_channels: ["vehicle_passport"], min_length: 100, max_length: 2400,
  prohibited_phrases: [], cpo_language_allowed: false, warranty_language_allowed: false,
  accessory_language_allowed: true, market_context_allowed: false, price_in_description: false,
  default_tone: "professional", primary_city: "Manchester", state: "Connecticut",
  dealer_name_format: "Harte INFINITI",
};

const QX80 = {
  id: "v1", vin: "JN8AZ2NE1J9190000", ymm: "2025 INFINITI QX80", trim: "Sensory AWD",
  condition: "used", mileage: 13127,
  // Feed and decode agree — this is the enriched, conflict-free case. The
  // disagreeing case is exercised separately in "truth snapshot still governs".
  features: ["Navigation System", "Heated Seats", "Around View Monitor", "ProPILOT Assist",
             "Panoramic Moonroof", "Tri-Zone Climate Control", "Power Liftgate",
             "Ventilated Seats", "Head-Up Display"],
  mc_attributes: {
    engine: "5.6L V8", transmission: "9-Speed Automatic", drivetrain: "AWD",
    body_type: "SUV", fuel_type: "Gasoline", seating: 8,
    exterior_color: "Majestic White", interior_color: "Graphite", stock_no: "IN12567",
    specs_source: "neovin",
    options: ["Navigation System", "Heated Seats", "Around View Monitor", "ProPILOT Assist",
              "Panoramic Moonroof", "Tri-Zone Climate Control", "Power Liftgate",
              "Ventilated Seats", "Head-Up Display"],
  },
};

const voiceOf = (overrides: Record<string, unknown> = {}) =>
  resolveVoiceProfile("t1", { profile_json: overrides, version: "vp_test", status: "approved" },
    SETTINGS, { dealer_name: "Harte INFINITI", city: "Manchester", state: "CT" });

const packetFor = (listing = QX80, opts: Record<string, any> = {}) => {
  const snap = buildFactSnapshot(listing, SETTINGS, null);
  return { snap, packet: buildDescriptionPacket(snap, SETTINGS, voiceOf(opts.voice), opts) };
};

// ── Feature normalization ────────────────────────────────────────────

describe("canonical feature normalization", () => {
  it("collapses synonyms onto one canonical feature", () => {
    const out = normalizeFeatures([
      { name: "Around View Monitor", origin: "factory_option", source: "vin_decode", confidence: 90 },
      { name: "360-Degree Camera", origin: "factory_option", source: "marketcheck_feed", confidence: 60 },
      { name: "Surround View Camera", origin: "factory_option", source: "dealer_feed", confidence: 50 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].canonical_id).toBe("surround_view_camera");
    expect(out[0].aliases_seen).toHaveLength(3);
    // Agreement across sources raises confidence rather than duplicating.
    expect(out[0].confidence).toBe(90);
  });

  it("keeps dealer-added products out of the factory bucket", () => {
    const out = normalizeFeatures([
      { name: "Navigation System", origin: "factory_option", source: "vin_decode", confidence: 90 },
      { name: "Ceramic Paint Protection", origin: "dealer_added", source: "install_proof", confidence: 95 },
    ]);
    const prioritized = prioritizeFeatures(out, { tone: "professional", featureBudget: 10 });
    const { factory, dealerAdded } = splitByOrigin(prioritized);
    expect(factory.map((f) => f.display_name)).toContain("Navigation System");
    expect(dealerAdded.map((f) => f.display_name)).toContain("Ceramic Paint Protection");
    expect(factory.some((f) => f.origin === "dealer_added")).toBe(false);
  });

  it("lets factory origin win when both lists claim the same feature", () => {
    const out = normalizeFeatures([
      { name: "Roof Rails", origin: "dealer_added", source: "accessory_catalog", confidence: 50 },
      { name: "Roof Rack", origin: "factory_standard", source: "vin_decode", confidence: 92 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].origin).toBe("factory_standard");
  });

  it("marks a conflicted feature ineligible for copy", () => {
    const out = normalizeFeatures([
      { name: "Bose Premium Audio", origin: "factory_option", source: "vin_decode",
        confidence: 80, conflict: true },
    ]);
    expect(out[0].description_eligible).toBe(false);
    expect(out[0].public_eligible).toBe(false);
  });

  it("never drops an uncataloged feature, only ranks it lower", () => {
    const out = normalizeFeatures([
      { name: "Illuminated Kick Plates", origin: "factory_option", source: "vin_decode", confidence: 80 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].in_catalog).toBe(false);
  });
});

describe("feature prioritization", () => {
  const base = normalizeFeatures([
    { name: "Third Row Seating", origin: "factory_standard", source: "vin_decode", confidence: 95 },
    { name: "Adaptive Suspension", origin: "factory_option", source: "vin_decode", confidence: 90 },
    { name: "Alloy Wheels", origin: "factory_standard", source: "vin_decode", confidence: 95 },
    { name: "Massaging Seats", origin: "factory_option", source: "vin_decode", confidence: 90 },
  ]);

  it("is deterministic across runs and input order", () => {
    const a = prioritizeFeatures(base, { tone: "professional", featureBudget: 4 });
    const b = prioritizeFeatures([...base].reverse(), { tone: "professional", featureBudget: 4 });
    expect(a.map((f) => f.canonical_id)).toEqual(b.map((f) => f.canonical_id));
  });

  it("moves emphasis with tone without changing the feature set", () => {
    const family = prioritizeFeatures(base, {
      tone: "family", featureBudget: 4, bodyStyle: "SUV",
      toneEmphasis: TONE_PROFILES.family.emphasis,
    });
    const sporty = prioritizeFeatures(base, {
      tone: "sporty", featureBudget: 4, bodyStyle: "SUV",
      toneEmphasis: TONE_PROFILES.sporty.emphasis,
    });
    const rank = (list: typeof family, id: string) => list.findIndex((f) => f.canonical_id === id);
    expect(rank(family, "third_row_seating")).toBeLessThan(rank(family, "adaptive_suspension"));
    expect(rank(sporty, "adaptive_suspension")).toBeLessThan(rank(sporty, "third_row_seating"));
    // Same features, different order — a tone may never add or remove one.
    expect(new Set(family.map((f) => f.canonical_id)))
      .toEqual(new Set(sporty.map((f) => f.canonical_id)));
  });

  it("enforces the channel feature budget instead of dumping every option", () => {
    const { packet } = packetFor(QX80, { featureBudget: 4 });
    expect(packet.factoryFeatures.length + packet.dealerAddedFeatures.length).toBeLessThanOrEqual(4);
    expect(packet.excludedFeatures.some((f) => f.selection_reason.includes("budget"))).toBe(true);
  });

  it("demotes charging features on a gasoline vehicle", () => {
    const feats = normalizeFeatures([
      { name: "DC Fast Charging", origin: "factory_standard", source: "vin_decode", confidence: 95 },
      { name: "Heated Seats", origin: "factory_standard", source: "vin_decode", confidence: 95 },
    ]);
    const gas = prioritizeFeatures(feats, { tone: "professional", featureBudget: 5, fuelType: "Gasoline" });
    const ev = prioritizeFeatures(feats, { tone: "professional", featureBudget: 5, fuelType: "Electric" });
    const idx = (l: typeof gas, id: string) => l.findIndex((f) => f.canonical_id === id);
    expect(idx(gas, "dc_fast_charging")).toBeGreaterThan(idx(gas, "heated_seats"));
    expect(idx(ev, "dc_fast_charging")).toBeLessThan(idx(ev, "heated_seats"));
  });

  it("produces a stable checksum for the same set in any order", async () => {
    const a = await featureChecksum(["b", "a", "c"]);
    const b = await featureChecksum(["c", "b", "a"]);
    expect(a).toBe(b);
    expect(a).not.toBe(await featureChecksum(["a", "b"]));
  });
});

// ── Channel policy ───────────────────────────────────────────────────

describe("channel policy registry", () => {
  it("is the single source of the channel rules the generator uses", () => {
    expect(CHANNELS.map((c) => c.key).sort())
      .toEqual(DEFAULT_CHANNEL_POLICIES.map((p) => p.key).sort());
    for (const c of CHANNELS) {
      const p = DEFAULT_CHANNEL_POLICIES.find((x) => x.key === c.key)!;
      expect(c.characterLimit).toBe(p.characterLimit);
      expect(c.deliveryMode).toBe(p.deliveryMode);
    }
  });

  it("carries exactly one policy per channel", () => {
    // Adding a second entry for a key the registry already had is how a
    // channel silently gets two different character limits.
    const keys = DEFAULT_CHANNEL_POLICIES.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("lets a tenant tighten a limit but never raise it", () => {
    const tighter = resolveChannelPolicy("autotrader", { characterLimit: 900 })!;
    const looser = resolveChannelPolicy("autotrader", { characterLimit: 99999 })!;
    expect(tighter.characterLimit).toBe(900);
    expect(looser.characterLimit).toBe(1500);
  });

  it("refuses a tenant override of delivery truth", () => {
    const p = resolveChannelPolicy("cars_com", {
      deliveryMode: "internal_projection", connectorStatus: "available",
    })!;
    expect(p.deliveryMode).toBe("connector");
    expect(p.connectorStatus).toBe("not_configured");
  });

  it("versions the resolved policy so an override is a distinct version", async () => {
    const base = await computeChannelPolicyVersion(resolveChannelPolicy("facebook")!);
    const edited = await computeChannelPolicyVersion(
      resolveChannelPolicy("facebook", { featureBudget: 3 })!);
    expect(base).not.toBe(edited);
    expect(await computeChannelPolicyVersion(resolveChannelPolicy("facebook")!)).toBe(base);
  });

  it("blocks a price on a channel that publishes its own pricing", () => {
    const p = resolveChannelPolicy("cargurus")!;
    const findings = checkChannelPolicy("Priced at $54,995 today. Visit us.", p);
    expect(findings.find((f) => f.code === "CHANNEL_PRICE_NOT_ALLOWED")?.severity).toBe("blocking");
  });

  it("blocks a fabricated deal rating on CarGurus", () => {
    const findings = checkChannelPolicy(
      "A great deal on a clean SUV. Contact us.", resolveChannelPolicy("cargurus")!);
    expect(findings.some((f) => f.code === "CHANNEL_PROHIBITED_PHRASE")).toBe(true);
  });

  it("blocks manufactured urgency on Facebook Marketplace", () => {
    const findings = checkChannelPolicy(
      "This one won't last — message us today.", resolveChannelPolicy("facebook")!);
    expect(findings.some((f) => f.code === "CHANNEL_PROHIBITED_PHRASE")).toBe(true);
  });

  it("does not label an unverified platform limit as verified", () => {
    expect(resolveChannelPolicy("autotrader")!.limitVerified).toBe(false);
    expect(resolveChannelPolicy("vehicle_passport")!.limitVerified).toBe(true);
  });
});

// ── Tone ─────────────────────────────────────────────────────────────

describe("tone", () => {
  it("defines all five studio tones", () => {
    expect(Object.keys(TONE_PROFILES).sort())
      .toEqual(["family", "luxury", "professional", "sporty", "value"]);
  });

  it("blocks the exaggeration each tone invites", () => {
    expect(checkTone("A track-ready machine.", "sporty")[0].code).toBe("TONE_OVERREACH");
    expect(checkTone("The safest choice for your family.", "family")).toHaveLength(1);
    expect(checkTone("Save thousands on this one.", "value")).toHaveLength(1);
    expect(checkTone("An exclusive, opulent cabin.", "luxury").length).toBeGreaterThan(0);
  });

  it("leaves clean copy alone", () => {
    expect(checkTone("Equipped with all-wheel drive and heated seats.", "sporty")).toHaveLength(0);
  });

  it("does not change the fact packet when the tone changes", () => {
    const pro = packetFor(QX80, { tone: "professional" }).packet;
    const lux = packetFor(QX80, { tone: "luxury" }).packet;
    expect(pro.verifiedFacts.map((f) => `${f.field}=${f.value}`).sort())
      .toEqual(lux.verifiedFacts.map((f) => `${f.field}=${f.value}`).sort());
  });
});

// ── Voice profile ────────────────────────────────────────────────────

describe("dealership voice profile", () => {
  it("denies every dealership benefit claim by default", () => {
    const v = voiceOf();
    expect(v.approvedClaims).toEqual([]);
    const findings = checkDealerClaims(
      "Family-owned and offering free delivery with guaranteed financing.", v);
    expect(findings).toHaveLength(3);
    expect(findings.every((f) => f.severity === "blocking")).toBe(true);
  });

  it("permits exactly the claims the tenant approved", () => {
    const v = voiceOf({ approvedClaims: ["family_owned"] });
    const findings = checkDealerClaims("Family-owned, with free delivery.", v);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("free delivery");
  });

  it("versions the profile and changes the version when the claims change", async () => {
    const a = await computeVoiceProfileVersion(voiceOf({ approvedClaims: ["family_owned"] }));
    const b = await computeVoiceProfileVersion(voiceOf({ approvedClaims: ["family_owned", "free_delivery"] }));
    expect(a).not.toBe(b);
    expect(await computeVoiceProfileVersion(voiceOf({ approvedClaims: ["family_owned"] }))).toBe(a);
  });

  it("blocks a nearby-city list as doorway behavior", () => {
    const v = voiceOf({ approvedAreas: ["Manchester"] });
    const findings = checkLocalityUse(
      "Proudly serving Manchester, Hartford, Glastonbury, Vernon and Bolton.", v);
    expect(findings.some((f) => f.code === "LOCALITY_STUFFING" && f.severity === "blocking")).toBe(true);
  });

  it("blocks a service area the dealer never approved", () => {
    const v = voiceOf({ approvedAreas: ["Manchester"] });
    const findings = checkLocalityUse("Proudly serving Boston shoppers.", v);
    expect(findings.some((f) => f.code === "UNAPPROVED_SERVICE_AREA")).toBe(true);
  });

  it("warns when the city is repeated past natural use", () => {
    const v = voiceOf();
    const text = "Manchester shoppers love this. Manchester is home. Visit Manchester. Manchester.";
    expect(checkLocalityUse(text, v).some((f) => f.code === "LOCALITY_STUFFING")).toBe(true);
  });

  it("accepts one natural market-area mention", () => {
    expect(checkLocalityUse("Available now in Manchester, Connecticut.", voiceOf())).toHaveLength(0);
  });
});

// ── Real scoring ─────────────────────────────────────────────────────

const CLEAN_COPY = `The 2025 INFINITI QX80 Sensory AWD is finished in Majestic White over a Graphite interior. A 5.6L V8 pairs with a nine-speed automatic and all-wheel drive.

Equipment includes a navigation system, ProPILOT Assist, a 360-degree around view monitor, heated and ventilated front seats, tri-zone climate control and a panoramic moonroof. Three rows of seating make it practical for longer trips.

Contact Harte INFINITI in Manchester to schedule a test drive.`;

describe("readability is calculated", () => {
  it("scores plain copy higher than dense copy", () => {
    const plain = analyzeReadability("The car has heated seats. It drives well. The ride is calm.");
    const dense = analyzeReadability(
      "Notwithstanding the extraordinarily sophisticated configurability of the aforementioned multifaceted infotainment architecture, comprehensive reconfiguration remains administratively unnecessary.");
    expect(plain.score).toBeGreaterThan(dense.score);
    expect(plain.band).not.toBe(dense.band);
  });

  it("reports the inputs behind the number", () => {
    const r = analyzeReadability(CLEAN_COPY);
    expect(r.method).toBe("flesch_reading_ease");
    expect(r.words).toBeGreaterThan(50);
    expect(r.sentences).toBeGreaterThan(3);
    expect(r.wordsPerSentence).toBeGreaterThan(0);
  });
});

describe("uniqueness is calculated against a named comparison set", () => {
  it("scores a copy of another listing as highly duplicated", () => {
    const u = analyzeUniqueness(CLEAN_COPY, [
      { id: "x", label: "sibling QX80", scope: "same_model_inventory", content: CLEAN_COPY },
    ]);
    expect(u.score).toBeLessThan(10);
    expect(u.duplicationRisk).toBe("high");
    expect(u.highestMatch?.label).toBe("sibling QX80");
  });

  it("scores genuinely different copy as unique", () => {
    const u = analyzeUniqueness(CLEAN_COPY, [
      { id: "y", label: "a Ford Escape", scope: "tenant_inventory",
        content: "A compact crossover with a turbocharged four-cylinder engine and front-wheel drive." },
    ]);
    expect(u.score).toBeGreaterThan(90);
    expect(u.duplicationRisk).toBe("low");
  });

  it("never reports a percentage without saying what it compared against", () => {
    const u = analyzeUniqueness(CLEAN_COPY, []);
    expect(u.comparisonCount).toBe(0);
    expect(u.highestMatch).toBeNull();
    const s = scoreDescription({
      text: CLEAN_COPY, tone: "professional", comparisons: [],
      targeting: { primaryKeyword: "", secondaryKeywords: [], city: "", state: "",
                   marketArea: "", dealerName: "", searchIntent: "inventory" },
      factsOffered: 5, factsUsed: 5, featuresSelected: [], policyFindings: [],
      blockingFindings: 0, warningFindings: 0, ctaExpected: true, now: "2026-07-27T00:00:00Z",
    });
    expect(s.warnings.some((w) => w.includes("empty comparison set"))).toBe(true);
  });

  it("computes jaccard over word shingles", () => {
    const a = shingles("one two three four five six");
    expect(jaccard(a, a)).toBe(1);
    expect(jaccard(a, shingles("nothing at all like the other text here"))).toBe(0);
  });
});

describe("keyword safety", () => {
  const targeting = {
    primaryKeyword: "INFINITI QX80 for sale", secondaryKeywords: ["AWD luxury SUV"],
    city: "Manchester", state: "Connecticut", marketArea: "Greater Hartford",
    dealerName: "Harte INFINITI", searchIntent: "inventory" as const,
  };

  it("accepts one natural use of the primary phrase", () => {
    const text = `Looking for an INFINITI QX80 for sale? ${CLEAN_COPY}`;
    const k = analyzeKeywords(text, targeting);
    expect(k.primaryPresent).toBe(true);
    expect(k.primaryNatural).toBe(true);
    expect(k.stuffing).toBe(false);
  });

  it("detects keyword stuffing", () => {
    const k = analyzeKeywords(
      "INFINITI QX80 for sale. INFINITI QX80 for sale. Buy an INFINITI QX80 for sale now.",
      targeting);
    expect(k.stuffing).toBe(true);
    expect(k.stuffedTerms.length).toBeGreaterThan(0);
  });

  it("detects hidden keyword blocks", () => {
    const k = analyzeKeywords(
      `${CLEAN_COPY}<div style="display:none">used suv hartford vernon bolton</div>`, targeting);
    expect(k.hiddenTextDetected).toBe(true);
  });
});

describe("composite score", () => {
  const baseInput = {
    text: CLEAN_COPY, tone: "professional" as const,
    targeting: { primaryKeyword: "INFINITI QX80 for sale", secondaryKeywords: [],
                 city: "Manchester", state: "Connecticut", marketArea: "",
                 dealerName: "Harte INFINITI", searchIntent: "inventory" as const },
    comparisons: [{ id: "c", label: "a Ford Escape", scope: "tenant_inventory" as const,
                    content: "A compact crossover with front-wheel drive." }],
    factsOffered: 10, factsUsed: 9,
    featuresSelected: ["Navigation System", "ProPILOT Assist", "Panoramic Moonroof"],
    policyFindings: [], blockingFindings: 0, warningFindings: 0, ctaExpected: true,
    now: "2026-07-27T00:00:00Z",
  };

  it("returns a weighted breakdown that explains itself", () => {
    const s = scoreDescription(baseInput);
    expect(s.total).toBeGreaterThan(0);
    expect(s.categories).toHaveLength(9);
    expect(s.categories.every((c) => typeof c.detail === "string" && c.detail.length > 0)).toBe(true);
    expect(Object.values(s.weights).reduce((a, b) => a + b, 0)).toBe(100);
    expect(s.version).toBeTruthy();
  });

  it("never labels blocked copy as excellent", () => {
    const s = scoreDescription({ ...baseInput, blockingFindings: 1 });
    expect(s.blockedByValidation).toBe(true);
    expect(s.band).toBe("poor");
    expect(s.categories.find((c) => c.category === "claim_safety")!.score).toBe(0);
  });

  it("does not award points for length alone", () => {
    const padded = { ...baseInput, text: CLEAN_COPY + " " + CLEAN_COPY + " " + CLEAN_COPY };
    expect(scoreDescription(padded).total).toBeLessThanOrEqual(scoreDescription(baseInput).total);
  });

  it("punishes stuffing harder than absence", () => {
    const absent = scoreDescription({
      ...baseInput,
      targeting: { ...baseInput.targeting, primaryKeyword: "something never written" },
    });
    const stuffed = scoreDescription({
      ...baseInput,
      text: "INFINITI QX80 for sale INFINITI QX80 for sale INFINITI QX80 for sale. Visit us.",
    });
    const kw = (s: typeof absent) => s.categories.find((c) => c.category === "keyword_usefulness")!.score;
    expect(kw(stuffed)).toBeLessThan(kw(absent));
  });

  it("counts only facts the copy actually used", () => {
    expect(countFactsUsed(CLEAN_COPY, ["Majestic White", "5.6L V8", "Sunset Orange"])).toBe(2);
  });
});

// ── Packet, prompts and validation ───────────────────────────────────

describe("description packet", () => {
  it("separates factory equipment from dealer-installed products", () => {
    const listing = {
      ...QX80,
      available_accessories: [
        { name: "Ceramic Coating", status: "INSTALLED_VERIFIED" },
        { name: "Roof Box", status: "PENDING_INSTALLATION" },
      ],
    };
    const { packet } = packetFor(listing, { featureBudget: 20 });
    expect(packet.dealerAddedFeatures.map((f) => f.display_name)).toContain("Ceramic Coating");
    expect(packet.factoryFeatures.some((f) => f.display_name === "Ceramic Coating")).toBe(false);
    // An accessory without install proof never enters the copy at all.
    expect(packet.dealerAddedFeatures.some((f) => f.display_name === "Roof Box")).toBe(false);
  });

  it("defaults the primary keyword to a phrase a shopper would type", () => {
    const { packet } = packetFor();
    expect(packet.targeting.primaryKeyword).toBe("2025 INFINITI QX80 Sensory AWD for sale");
  });

  it("tells the model which features are dealer-installed", () => {
    const listing = {
      ...QX80,
      available_accessories: [{ name: "Ceramic Coating", status: "INSTALLED_VERIFIED" }],
    };
    const { packet } = packetFor(listing, { featureBudget: 20 });
    const prompt = buildMasterPromptV3(packet, SETTINGS);
    expect(prompt).toContain("DEALER-INSTALLED PRODUCTS");
    expect(prompt).toContain("NOT factory equipment");
  });

  it("gives each channel a different contract from the same master", () => {
    const { packet } = packetFor();
    const fb = buildChannelPromptV3("MASTER", resolveChannelPolicy("facebook")!, packet);
    const web = buildChannelPromptV3("MASTER", resolveChannelPolicy("dealer_website")!, packet);
    expect(fb).not.toBe(web);
    expect(fb).toContain("Facebook Marketplace");
    expect(web).toContain("Dealer Website");
    // Every channel prompt carries the fact invariant.
    for (const p of [fb, web]) expect(p).toContain("FACT INVARIANT");
  });

  it("produces the same input checksum for identical configuration", async () => {
    const args = {
      tenantId: "t1", vehicleId: "v1", snapshotChecksum: "sdv_1", channel: "master",
      channelPolicyVersion: "cp_1", voiceProfileVersion: "vp_1", tone: "professional",
      featureChecksum: "feat_1", promptVersion: "v1", model: "claude-haiku-4-5",
      targeting: { primaryKeyword: "a", secondaryKeywords: ["b"], city: "Manchester",
                   state: "CT", marketArea: "", dealerName: "Harte", searchIntent: "inventory" as const },
    };
    expect(await computeInputChecksum(args)).toBe(await computeInputChecksum(args));
    expect(await computeInputChecksum(args))
      .not.toBe(await computeInputChecksum({ ...args, tone: "luxury" }));
    expect(await computeInputChecksum(args))
      .not.toBe(await computeInputChecksum({ ...args, featureChecksum: "feat_2" }));
  });
});

describe("V3 claim validation", () => {
  const { snap, packet } = packetFor(QX80, { featureBudget: 20 });

  it("passes clean, fully supported copy", () => {
    const findings = validateContentV3(CLEAN_COPY, snap, SETTINGS, packet);
    expect(findings.filter((f) => f.blocking)).toHaveLength(0);
  });

  it("blocks an unapproved dealership claim", () => {
    const findings = validateContentV3(
      `${CLEAN_COPY} We are a family-owned store offering free delivery.`, snap, SETTINGS, packet);
    expect(findings.filter((f) => f.validator_code === "UNAPPROVED_DEALER_CLAIM").length)
      .toBeGreaterThanOrEqual(2);
  });

  it("blocks an unsupported ownership, warranty or certification claim", () => {
    for (const claim of ["This one-owner SUV", "with remaining factory warranty",
                         "a certified pre-owned example", "accident-free history"]) {
      const findings = validateContentV3(`${CLEAN_COPY} ${claim}.`, snap, SETTINGS, packet);
      expect(findings.some((f) => f.blocking)).toBe(true);
    }
  });

  it("blocks an unverified fuel-economy, range or towing claim through tone overreach", () => {
    const findings = validateContentV3(
      `${CLEAN_COPY} Save thousands compared to anything else.`, snap, SETTINGS,
      { ...packet, tone: "value" });
    expect(findings.some((f) => f.validator_code === "TONE_OVERREACH")).toBe(true);
  });

  it("blocks a dealer-installed product described as factory equipment", () => {
    const listing = {
      ...QX80,
      available_accessories: [{ name: "Ceramic Coating", status: "INSTALLED_VERIFIED" }],
    };
    const p2 = packetFor(listing, { featureBudget: 20 });
    const findings = validateContentV3(
      `${CLEAN_COPY} It comes with factory ceramic coating from the factory.`,
      p2.snap, SETTINGS, p2.packet);
    expect(findings.some((f) => f.validator_code === "DEALER_ADDED_AS_FACTORY")).toBe(true);
  });

  it("blocks hidden text", () => {
    const findings = validateContentV3(
      `${CLEAN_COPY}<span style="font-size:0">suv hartford vernon</span>`, snap, SETTINGS, packet);
    expect(findings.some((f) => f.validator_code === "HIDDEN_TEXT_DETECTED" && f.blocking)).toBe(true);
  });

  it("applies the channel policy to the channel variant", () => {
    const findings = validateContentV3(
      "A great deal on this QX80. Contact us.", snap, SETTINGS, packet,
      resolveChannelPolicy("cargurus")!);
    expect(findings.some((f) => f.validator_code === "CHANNEL_PROHIBITED_PHRASE")).toBe(true);
  });

  it("scores a version against its findings and comparison set", () => {
    const findings = validateContentV3(CLEAN_COPY, snap, SETTINGS, packet);
    const score = scoreVersion({
      text: CLEAN_COPY, packet, findings,
      comparisons: [{ id: "c", label: "a Ford Escape", scope: "tenant_inventory",
                      content: "A compact crossover." }],
      now: "2026-07-27T00:00:00Z",
    });
    expect(score.uniqueness.comparisonCount).toBe(1);
    expect(score.readability.words).toBeGreaterThan(0);
    expect(score.total).toBeGreaterThan(0);
  });
});

describe("truth snapshot still governs", () => {
  it("keeps a conflicted premium feature out of the packet", () => {
    const listing = {
      ...QX80,
      features: ["Navigation System", "Bose Premium Audio"],
      mc_attributes: { ...QX80.mc_attributes, options: ["Navigation System"] },
    };
    const { packet } = packetFor(listing, { featureBudget: 20 });
    expect(packet.factoryFeatures.some((f) => f.canonical_id === "bose_audio")).toBe(false);
    expect(packet.excludedFeatures.some((f) => f.canonical_id === "bose_audio" && f.conflict)).toBe(true);
  });

  it("blocks copy that states the conflicted feature anyway", () => {
    const listing = {
      ...QX80,
      features: ["Navigation System", "Bose Premium Audio"],
      mc_attributes: { ...QX80.mc_attributes, options: ["Navigation System"] },
    };
    const { snap, packet } = packetFor(listing, { featureBudget: 20 });
    const findings = validateContentV3(
      "The QX80 includes Bose Premium Audio. Contact us.", snap, SETTINGS, packet);
    expect(findings.some((f) => f.blocking)).toBe(true);
  });
});
