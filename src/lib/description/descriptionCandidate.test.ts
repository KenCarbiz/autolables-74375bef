import { describe, it, expect } from "vitest";
import {
  CANDIDATE_SCHEMA_VERSION, FORBIDDEN_CANDIDATE_FIELDS,
  parseCandidate, stripCodeFences, coercePlainText, normalizeCandidate,
  type DescriptionCandidate,
} from "../../../supabase/functions/_shared/description-candidate";

// The generator's output is untrusted input. These tests pin the two rules
// that matter: presentation defects are repairable, and an attempt to assert
// approval, identity or a score is rejected outright and never repaired.

const VALID = {
  schemaVersion: CANDIDATE_SCHEMA_VERSION,
  title: "2025 INFINITI QX80 Sensory AWD",
  shortSummary: "A three-row Sensory AWD in Majestic White.",
  mainDescription: "The 2025 INFINITI QX80 Sensory AWD is finished in Majestic White.\n\nContact Harte INFINITI to schedule a test drive.",
  paragraphs: [
    "The 2025 INFINITI QX80 Sensory AWD is finished in Majestic White.",
    "Contact Harte INFINITI to schedule a test drive.",
  ],
  featureHighlights: ["Navigation system", "Heated front seats"],
  ctaText: "Contact Harte INFINITI to schedule a test drive.",
  disclosureText: null,
  primaryKeywordUsed: true,
  secondaryKeywordsUsed: ["qx80 for sale"],
  claimedFeatureIds: ["feat_nav", "feat_heated_seats"],
  omittedFeatureIds: ["feat_tow"],
  uncertaintyFlags: [],
  candidateWarnings: [],
};

const candidateOf = (over: Partial<DescriptionCandidate> = {}): DescriptionCandidate => ({
  schemaVersion: CANDIDATE_SCHEMA_VERSION,
  title: null,
  shortSummary: null,
  mainDescription: "",
  paragraphs: [],
  featureHighlights: [],
  ctaText: null,
  disclosureText: null,
  primaryKeywordUsed: false,
  secondaryKeywordsUsed: [],
  claimedFeatureIds: [],
  omittedFeatureIds: [],
  uncertaintyFlags: [],
  candidateWarnings: [],
  ...over,
});

describe("parseCandidate — structured output", () => {
  it("parses a well-formed candidate", () => {
    const r = parseCandidate(JSON.stringify(VALID));
    expect(r.ok).toBe(true);
    expect(r.code).toBe("OK");
    expect(r.errors).toEqual([]);
    expect(r.candidate?.mainDescription).toContain("Majestic White");
    expect(r.candidate?.featureHighlights).toEqual(["Navigation system", "Heated front seats"]);
    expect(r.candidate?.claimedFeatureIds).toEqual(["feat_nav", "feat_heated_seats"]);
    expect(r.candidate?.primaryKeywordUsed).toBe(true);
    expect(r.rawLength).toBe(JSON.stringify(VALID).length);
  });

  it("parses JSON wrapped in a markdown code fence", () => {
    const r = parseCandidate("```json\n" + JSON.stringify(VALID) + "\n```");
    expect(r.ok).toBe(true);
    expect(r.candidate?.title).toBe(VALID.title);
  });

  it("parses a fenced block surrounded by chatter", () => {
    const r = parseCandidate("Here you go:\n```\n" + JSON.stringify(VALID) + "\n```\nLet me know.");
    expect(r.ok).toBe(true);
    expect(r.candidate?.mainDescription).toContain("Majestic White");
  });

  it("accepts the older channel contract keys", () => {
    const r = parseCandidate(JSON.stringify({
      seo_title: "2025 INFINITI QX80 for sale",
      meta_description: "Majestic White over Graphite.",
      content: "The 2025 INFINITI QX80 Sensory AWD is finished in Majestic White.",
    }));
    expect(r.ok).toBe(true);
    expect(r.candidate?.title).toBe("2025 INFINITI QX80 for sale");
    expect(r.candidate?.shortSummary).toBe("Majestic White over Graphite.");
    // An absent version is recorded, never silently treated as declared.
    expect(r.candidate?.candidateWarnings).toContain("schema_version_absent");
  });

  it("derives paragraphs when the model omits them", () => {
    const r = parseCandidate(JSON.stringify({ ...VALID, paragraphs: undefined }));
    expect(r.candidate?.paragraphs).toHaveLength(2);
  });
});

describe("parseCandidate — plain text", () => {
  const prose = "The 2025 INFINITI QX80 Sensory AWD is finished in Majestic White.\n\nContact Harte INFINITI to schedule a test drive.";

  it("rejects prose when structured output is required", () => {
    const r = parseCandidate(prose);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("NOT_JSON");
    expect(r.repairable).toBe(true);
    expect(r.candidate).toBeNull();
  });

  it("accepts prose when the channel allows it", () => {
    const r = parseCandidate(prose, { allowPlainText: true });
    expect(r.ok).toBe(true);
    expect(r.code).toBe("OK");
    expect(r.candidate?.mainDescription).toContain("Majestic White");
    expect(r.candidate?.paragraphs).toHaveLength(2);
    expect(r.candidate?.candidateWarnings).toContain("coerced_from_plain_text");
  });

  it("coerces prose without asserting anything the model did not write", () => {
    const c = coercePlainText(prose);
    expect(c.title).toBeNull();
    expect(c.shortSummary).toBeNull();
    expect(c.featureHighlights).toEqual([]);
    expect(c.claimedFeatureIds).toEqual([]);
    expect(c.primaryKeywordUsed).toBe(false);
  });
});

describe("parseCandidate — rejections", () => {
  it("treats an empty response as EMPTY_RESPONSE", () => {
    for (const raw of ["", "   \n  ", "```json\n\n```"]) {
      const r = parseCandidate(raw);
      expect(r.code).toBe("EMPTY_RESPONSE");
      expect(r.ok).toBe(false);
    }
  });

  it("treats a whitespace-only body as EMPTY_RESPONSE, not a valid candidate", () => {
    const r = parseCandidate(JSON.stringify({ ...VALID, mainDescription: "   \n\t ", paragraphs: [] }));
    expect(r.code).toBe("EMPTY_RESPONSE");
    expect(r.candidate).toBeNull();
  });

  it("flags a missing mainDescription as repairable", () => {
    const { mainDescription, ...rest } = VALID;
    void mainDescription;
    const r = parseCandidate(JSON.stringify(rest));
    expect(r.code).toBe("MISSING_REQUIRED_FIELD");
    expect(r.repairable).toBe(true);
  });

  it("flags a non-object JSON payload as a repairable schema mismatch", () => {
    const r = parseCandidate(JSON.stringify([VALID]));
    expect(r.code).toBe("SCHEMA_MISMATCH");
    expect(r.repairable).toBe(true);
  });

  it("rejects an unknown schema version", () => {
    const r = parseCandidate(JSON.stringify({ ...VALID, schemaVersion: "candidate_v99" }));
    expect(r.code).toBe("UNKNOWN_SCHEMA_VERSION");
    expect(r.ok).toBe(false);
    expect(r.candidate).toBeNull();
  });

  it("rejects wrong field types", () => {
    const bad = [
      { ...VALID, featureHighlights: "Navigation system" },
      { ...VALID, claimedFeatureIds: [1, 2] },
      { ...VALID, primaryKeywordUsed: "yes" },
      { ...VALID, title: 2025 },
      { ...VALID, mainDescription: { text: "hello" } },
      { ...VALID, schemaVersion: 1 },
    ];
    for (const payload of bad) {
      const r = parseCandidate(JSON.stringify(payload));
      expect(r.ok).toBe(false);
      expect(r.code).toBe("INVALID_FIELD_TYPE");
    }
  });
});

describe("parseCandidate — forbidden authority fields", () => {
  it("rejects a model-supplied approval, score or identity and does not offer repair", () => {
    const attempts: Array<Record<string, unknown>> = [
      { ...VALID, approvalStatus: "approved" },
      { ...VALID, approved: true },
      { ...VALID, published: true },
      { ...VALID, publicationStatus: "live" },
      { ...VALID, score: 98 },
      { ...VALID, qualityScore: 98 },
      { ...VALID, validationStatus: "passed" },
      { ...VALID, id: "ver_123" },
      { ...VALID, versionId: "ver_123" },
      { ...VALID, descriptionId: "desc_123" },
      { ...VALID, tenantId: "tenant_123" },
      { ...VALID, vehicleId: "veh_123" },
    ];
    for (const payload of attempts) {
      const r = parseCandidate(JSON.stringify(payload));
      expect(r.code).toBe("FORBIDDEN_FIELD");
      expect(r.ok).toBe(false);
      // A model asserting its own approval is not a formatting problem.
      expect(r.repairable).toBe(false);
      expect(r.candidate).toBeNull();
    }
  });

  it("catches the snake_case spelling of a forbidden field", () => {
    const r = parseCandidate(JSON.stringify({ ...VALID, approval_status: "approved", quality_score: 100 }));
    expect(r.code).toBe("FORBIDDEN_FIELD");
    expect(r.errors.join(" ")).toContain("approval_status");
  });

  it("rejects the forbidden field even inside a code fence", () => {
    const r = parseCandidate("```json\n" + JSON.stringify({ ...VALID, approved: true }) + "\n```");
    expect(r.code).toBe("FORBIDDEN_FIELD");
    expect(r.repairable).toBe(false);
  });

  it("exports every authority field it must guard", () => {
    expect(FORBIDDEN_CANDIDATE_FIELDS).toEqual([
      "id", "versionId", "descriptionId", "approvalStatus", "approved", "published",
      "publicationStatus", "score", "qualityScore", "validationStatus", "tenantId", "vehicleId",
    ]);
  });
});

describe("stripCodeFences", () => {
  it("removes a json fence and leaves bare text alone", () => {
    expect(stripCodeFences("```json\n{\"a\":1}\n```")).toBe('{"a":1}');
    expect(stripCodeFences("```\n{\"a\":1}\n```")).toBe('{"a":1}');
    expect(stripCodeFences("just text")).toBe("just text");
  });
});

describe("normalizeCandidate", () => {
  it("collapses whitespace without changing a single word", () => {
    const messy = "The   2025    INFINITI  QX80\t\tSensory AWD is  finished in Majestic White.\n\n\n\nContact   Harte INFINITI to schedule a test drive.  ";
    const n = normalizeCandidate(candidateOf({ mainDescription: messy }));
    expect(n.mainDescription).toBe(
      "The 2025 INFINITI QX80 Sensory AWD is finished in Majestic White.\n\nContact Harte INFINITI to schedule a test drive.",
    );
    // Word-for-word identity is the invariant: normalization may not reword.
    expect(n.mainDescription.split(/\s+/)).toEqual(messy.trim().split(/\s+/));
  });

  it("prunes empty paragraphs and array entries without reordering the rest", () => {
    const n = normalizeCandidate(candidateOf({
      mainDescription: "Body copy.",
      paragraphs: ["  First paragraph.  ", "   ", "Second paragraph."],
      featureHighlights: ["Navigation system", "  ", " Heated front seats "],
    }));
    expect(n.paragraphs).toEqual(["First paragraph.", "Second paragraph."]);
    expect(n.featureHighlights).toEqual(["Navigation system", "Heated front seats"]);
  });

  it("does not truncate, retitle or invent content", () => {
    const n = normalizeCandidate(candidateOf({
      title: "  2025 INFINITI QX80  ",
      mainDescription: "A sentence with no closing punctuation",
      ctaText: "   ",
    }));
    expect(n.title).toBe("2025 INFINITI QX80");
    expect(n.mainDescription).toBe("A sentence with no closing punctuation");
    expect(n.ctaText).toBeNull();
    expect(n.schemaVersion).toBe(CANDIDATE_SCHEMA_VERSION);
  });

  it("strips a fence the model left inside the body", () => {
    const n = normalizeCandidate(candidateOf({ mainDescription: "```\nBody copy stays.\n```" }));
    expect(n.mainDescription).toBe("Body copy stays.");
  });
});
