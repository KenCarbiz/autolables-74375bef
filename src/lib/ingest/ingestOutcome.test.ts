import { describe, it, expect } from "vitest";
import {
  INGEST_STEPS,
  RECORDABLE_STATUSES,
  buildIngestOutcomes,
  modelMatches,
  parseYmm,
  pickOemLink,
  summarizeIngestOutcomes,
  type IngestOutcomeInput,
  type IngestStepOutcome,
} from "./ingestOutcome";

const base: IngestOutcomeInput = { vin: "1HGCV1F30LA000001", ymm: "2026 Toyota Camry" };

const outcomeFor = (step: string, input: IngestOutcomeInput): IngestStepOutcome => {
  const row = buildIngestOutcomes(input).find((o) => o.step === step);
  if (!row) throw new Error(`no outcome for ${step}`);
  return row;
};

describe("the storable status vocabulary", () => {
  it("cannot store not_run — absence of a row is the only way to say a step never ran", () => {
    expect(RECORDABLE_STATUSES).not.toContain("not_run");
    expect([...RECORDABLE_STATUSES].sort()).toEqual(
      ["failed", "parked", "running", "skipped", "succeeded"],
    );
  });
});

describe("parseYmm", () => {
  it("splits year / make / model the way the harvest callers do", () => {
    expect(parseYmm("2026 Toyota Camry XSE")).toEqual({ year: 2026, make: "Toyota", model: "Camry XSE" });
  });

  it("returns a null year rather than NaN when the string is not a year", () => {
    expect(parseYmm("Toyota Camry")).toEqual({ year: null, make: "Camry", model: "" });
    expect(parseYmm(null)).toEqual({ year: null, make: "", model: "" });
  });
});

describe("modelMatches", () => {
  it("matches case-insensitively but exactly, the way the passport reader's ilike does", () => {
    expect(modelMatches("camry", "CAMRY")).toBe(true);
    expect(modelMatches(" Camry ", "Camry")).toBe(true);
  });

  it("refuses a prefix, because the passport would show nothing for it", () => {
    expect(modelMatches("Camry", "Camry XSE")).toBe(false);
    expect(modelMatches("Camry XSE", "Camry")).toBe(false);
    expect(modelMatches("Corolla", "Camry")).toBe(false);
    expect(modelMatches("", "Camry")).toBe(false);
  });
});

describe("pickOemLink", () => {
  const rows = [
    { make: "Toyota", model: "Camry", year: 2022, url: "https://toyota.com/2022.pdf" },
    { make: "Toyota", model: "Camry", year: 2026, url: "https://toyota.com/2026.pdf" },
    { make: "Toyota", model: "Camry", year: null, url: "https://toyota.com/any.pdf" },
    { make: "Honda", model: "Accord", year: 2026, url: "https://honda.com/2026.pdf" },
  ];

  it("prefers the exact model year", () => {
    expect(pickOemLink(rows, "Toyota", "Camry", 2026)?.url).toBe("https://toyota.com/2026.pdf");
  });

  it("falls back within two model years, newest first, as the reader's year-DESC scan does", () => {
    expect(pickOemLink(rows, "Toyota", "Camry", 2024)?.url).toBe("https://toyota.com/2026.pdf");
    expect(pickOemLink(rows, "Toyota", "Camry", 2021)?.url).toBe("https://toyota.com/2022.pdf");
  });

  it("falls back to a year-less portal row, as the passport reader does", () => {
    expect(pickOemLink(rows, "Toyota", "Camry", 2015)?.url).toBe("https://toyota.com/any.pdf");
  });

  it("takes the newest row when the vehicle has no year", () => {
    expect(pickOemLink(rows, "Toyota", "Camry", null)?.url).toBe("https://toyota.com/2026.pdf");
  });

  it("does not answer a trimmed model with a base-model row", () => {
    expect(pickOemLink(rows, "Toyota", "Camry XSE", 2026)).toBeNull();
  });

  it("ignores rows with no url and other makes", () => {
    expect(pickOemLink([{ make: "Toyota", model: "Camry", year: 2026, url: "" }], "Toyota", "Camry", 2026)).toBeNull();
    expect(pickOemLink(rows, "Toyota", "Accord", 2026)).toBeNull();
  });
});

describe("window sticker outcome", () => {
  it("reports not_run with absent evidence when no build record exists", () => {
    const o = outcomeFor("factory_sticker", base);
    expect(o.status).toBe("not_run");
    expect(o.evidence).toBe("absent");
    expect(o.reason).toMatch(/no factory build record/i);
  });

  it("distinguishes a failed orchestrator call from a step that never ran", () => {
    const o = outcomeFor("factory_sticker", { ...base, autogenArtifacts: { factory_sticker: "http_429" } });
    expect(o.status).toBe("failed");
    expect(o.evidence).toBe("recorded");
    expect(o.reason).toContain("http_429");
  });

  it("reports a published record with a document as succeeded", () => {
    const o = outcomeFor("factory_sticker", {
      ...base,
      sticker: { generation_status: "PUBLISHED", current_document_id: "doc-1", published_at: "2026-07-28T10:00:00Z" },
    });
    expect(o.status).toBe("succeeded");
    expect(o.reason).toContain("2026-07-28T10:00:00Z");
  });

  it("refuses to call a published record with no document a success", () => {
    const o = outcomeFor("factory_sticker", {
      ...base,
      sticker: { generation_status: "PUBLISHED", current_document_id: null },
    });
    expect(o.status).toBe("parked");
    expect(o.reason).toMatch(/no document is attached/i);
  });

  it("parks on review and carries the recorded review reason", () => {
    const o = outcomeFor("factory_sticker", {
      ...base,
      sticker: { generation_status: "REVIEW_REQUIRED", review_required: true, review_reason: "MSRP variance of $1,240" },
    });
    expect(o.status).toBe("parked");
    expect(o.reason).toBe("MSRP variance of $1,240");
  });

  it("still says why when a parked record records no reason", () => {
    const o = outcomeFor("factory_sticker", { ...base, sticker: { generation_status: "REVIEW_REQUIRED" } });
    expect(o.status).toBe("parked");
    expect(o.reason).toMatch(/does not say why/i);
  });

  it("explains the awaiting-build-sheet park", () => {
    const o = outcomeFor("factory_sticker", { ...base, sticker: { generation_status: "PENDING_DATA" } });
    expect(o.status).toBe("parked");
    expect(o.reason).toMatch(/build sheet/i);
  });

  it("maps the in-flight states to running, not to success", () => {
    for (const state of ["NORMALIZING", "VALIDATING", "GENERATING", "RUNNING_QA"]) {
      expect(outcomeFor("factory_sticker", { ...base, sticker: { generation_status: state } }).status).toBe("running");
    }
  });

  it("surfaces the recorded error on both failure states", () => {
    const retry = outcomeFor("factory_sticker", {
      ...base, sticker: { generation_status: "FAILED_RETRYABLE", last_error: "renderer timeout" },
    });
    expect(retry.status).toBe("failed");
    expect(retry.reason).toBe("renderer timeout");
    const perm = outcomeFor("factory_sticker", { ...base, sticker: { generation_status: "FAILED_PERMANENT" } });
    expect(perm.status).toBe("failed");
    expect(perm.reason).toMatch(/will not retry on its own/i);
  });

  it("treats superseded and archived as deliberately not applicable", () => {
    expect(outcomeFor("factory_sticker", { ...base, sticker: { generation_status: "SUPERSEDED" } }).status).toBe("skipped");
    expect(outcomeFor("factory_sticker", { ...base, sticker: { generation_status: "ARCHIVED" } }).status).toBe("skipped");
  });

  it("never silently believes an unrecognized pipeline state", () => {
    const o = outcomeFor("factory_sticker", { ...base, sticker: { generation_status: "WAT" } });
    expect(o.status).toBe("parked");
    expect(o.reason).toContain("WAT");
  });
});

describe("brochure and owner's-manual outcomes", () => {
  it("reports not_run when no link and no attempt exist", () => {
    for (const step of ["oem_brochure", "owners_manual"]) {
      const o = outcomeFor(step, base);
      expect(o.status).toBe("not_run");
      expect(o.evidence).toBe("absent");
      expect(o.reason).toMatch(/nothing recorded a harvest attempt/i);
    }
  });

  it("marks a shared-cache hit as succeeded but only inferred", () => {
    const o = outcomeFor("oem_brochure", {
      ...base,
      brochureLinks: [{ make: "Toyota", model: "Camry", year: 2026, url: "https://toyota.com/b.pdf", verified_at: "2026-07-01T00:00:00Z" }],
    });
    expect(o.status).toBe("succeeded");
    expect(o.evidence).toBe("derived");
    expect(o.reason).toMatch(/inferred from the shared cache/i);
    expect(o.lastRunAt).toBe("2026-07-01T00:00:00Z");
  });

  it("keeps the two steps independent", () => {
    const input: IngestOutcomeInput = {
      ...base,
      brochureLinks: [{ make: "Toyota", model: "Camry", year: 2026, url: "https://toyota.com/b.pdf" }],
    };
    expect(outcomeFor("oem_brochure", input).status).toBe("succeeded");
    expect(outcomeFor("owners_manual", input).status).toBe("not_run");
  });

  it("reports a recorded harvest failure as failed", () => {
    const o = outcomeFor("owners_manual", { ...base, autogenArtifacts: { owners_manual: "manual_link_not_saved" } });
    expect(o.status).toBe("failed");
    expect(o.evidence).toBe("recorded");
    expect(o.reason).toContain("manual_link_not_saved");
  });

  it("says so when the vehicle has no usable year/make/model to look up", () => {
    const o = outcomeFor("oem_brochure", { vin: "X", ymm: "2026" });
    expect(o.status).toBe("not_run");
    expect(o.reason).toMatch(/no usable year\/make\/model/i);
  });

  it("does not claim a link for a trimmed model the passport reader would miss", () => {
    const o = outcomeFor("oem_brochure", {
      ...base,
      ymm: "2026 Toyota Camry XSE",
      brochureLinks: [{ make: "Toyota", model: "Camry", year: 2026, url: "https://toyota.com/b.pdf" }],
    });
    expect(o.status).toBe("not_run");
  });
});

describe("the packet-backfill negative cache explains a missing link", () => {
  const attempt = (over: Record<string, unknown> = {}) => ({
    kind: "brochure", make_key: "toyota", model_key: "camry", year_key: 2026,
    outcome: "not_found", attempts: 2, last_attempt_at: "2026-07-20T00:00:00Z", ...over,
  });

  it("reports an unsupported make as skipped, not as a failure to chase", () => {
    const o = outcomeFor("oem_brochure", { ...base, brochureAttempt: attempt({ outcome: "unsupported" }) });
    expect(o.status).toBe("skipped");
    expect(o.evidence).toBe("derived");
    expect(o.reason).toMatch(/allow-list/i);
  });

  it("reports a searched-and-empty triple as failed, with the search count", () => {
    const o = outcomeFor("oem_brochure", { ...base, brochureAttempt: attempt() });
    expect(o.status).toBe("failed");
    expect(o.reason).toMatch(/searched 2 times/i);
    expect(o.attemptCount).toBe(2);
    expect(o.lastRunAt).toBe("2026-07-20T00:00:00Z");
  });

  it("reports a harvest error as failed and says the sweep re-tries it", () => {
    const o = outcomeFor("oem_brochure", { ...base, brochureAttempt: attempt({ outcome: "error", detail: "firecrawl 502" }) });
    expect(o.status).toBe("failed");
    expect(o.reason).toContain("firecrawl 502");
    expect(o.reason).toMatch(/re-tried by the packet backfill sweep/i);
  });

  it("flags the contradiction when the sweep says found but no link resolves", () => {
    const o = outcomeFor("oem_brochure", { ...base, brochureAttempt: attempt({ outcome: "found" }) });
    expect(o.status).toBe("parked");
    expect(o.reason).toMatch(/shopper packet still shows nothing/i);
  });

  it("ignores an attempt row keyed to a different vehicle or the other kind", () => {
    expect(outcomeFor("oem_brochure", { ...base, brochureAttempt: attempt({ model_key: "corolla" }) }).status).toBe("not_run");
    expect(outcomeFor("oem_brochure", { ...base, brochureAttempt: attempt({ year_key: 2019 }) }).status).toBe("not_run");
    expect(outcomeFor("oem_brochure", { ...base, brochureAttempt: attempt({ kind: "owners_manual" }) }).status).toBe("not_run");
  });

  it("never lets the negative cache override an existing link", () => {
    const o = outcomeFor("oem_brochure", {
      ...base,
      brochureLinks: [{ make: "Toyota", model: "Camry", year: 2026, url: "https://toyota.com/b.pdf" }],
      brochureAttempt: attempt({ outcome: "not_found" }),
    });
    expect(o.status).toBe("succeeded");
  });
});

describe("the ledger overrides every derivation", () => {
  it("uses the recorded row instead of inferring from the shared cache", () => {
    const o = outcomeFor("oem_brochure", {
      ...base,
      brochureLinks: [{ make: "Toyota", model: "Camry", year: 2026, url: "https://toyota.com/b.pdf" }],
      ledger: [{ step: "oem_brochure", status: "failed", reason: "brochure_unreachable (404)", attempt_count: 3, last_run_at: "2026-07-29T01:00:00Z" }],
    });
    expect(o.status).toBe("failed");
    expect(o.evidence).toBe("recorded");
    expect(o.reason).toBe("brochure_unreachable (404)");
    expect(o.attemptCount).toBe(3);
  });

  it("overrides the sticker state machine when the step filed its own verdict", () => {
    const o = outcomeFor("factory_sticker", {
      ...base,
      sticker: { generation_status: "PUBLISHED", current_document_id: "doc-1" },
      ledger: [{ step: "factory_sticker", status: "skipped", reason: "Factory build records are disabled for this store." }],
    });
    expect(o.status).toBe("skipped");
    expect(o.reason).toMatch(/disabled for this store/i);
  });

  it("never reports a recorded row without a reason", () => {
    const o = outcomeFor("owners_manual", { ...base, ledger: [{ step: "owners_manual", status: "succeeded", reason: "  " }] });
    expect(o.reason.trim().length).toBeGreaterThan(0);
    expect(o.reason).toMatch(/without a reason/i);
  });

  it("parks an unrecognized recorded status instead of trusting it", () => {
    const o = outcomeFor("owners_manual", { ...base, ledger: [{ step: "owners_manual", status: "done", reason: "all good" }] });
    expect(o.status).toBe("parked");
    expect(o.reason).toContain("done");
    expect(o.reason).toContain("all good");
  });

  it("ignores ledger rows for other steps", () => {
    const o = outcomeFor("oem_brochure", { ...base, ledger: [{ step: "something_else", status: "succeeded", reason: "x" }] });
    expect(o.status).toBe("not_run");
  });
});

describe("buildIngestOutcomes shape", () => {
  it("always returns one outcome per step, in order, each with a non-empty reason", () => {
    const outcomes = buildIngestOutcomes(base);
    expect(outcomes.map((o) => o.step)).toEqual([...INGEST_STEPS]);
    for (const o of outcomes) {
      expect(o.reason.trim().length).toBeGreaterThan(0);
      expect(o.label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("summarizeIngestOutcomes", () => {
  it("counts a step that never ran as needing attention, never as confirmed", () => {
    const s = summarizeIngestOutcomes(buildIngestOutcomes(base));
    expect(s.confirmed).toBe(0);
    expect(s.inferred).toBe(0);
    expect(s.needsAttention).toBe(3);
    expect(s.headline).toBe("0 of 3 confirmed, 3 needing attention.");
  });

  it("separates confirmed from inferred success", () => {
    const s = summarizeIngestOutcomes(buildIngestOutcomes({
      ...base,
      sticker: { generation_status: "PUBLISHED", current_document_id: "doc-1" },
      brochureLinks: [{ make: "Toyota", model: "Camry", year: 2026, url: "https://toyota.com/b.pdf" }],
    }));
    expect(s.confirmed).toBe(1);
    expect(s.inferred).toBe(1);
    expect(s.needsAttention).toBe(1);
    expect(s.headline).toBe("1 of 3 confirmed, 1 inferred, 1 needing attention.");
  });

  it("counts running and skipped apart from both success and attention", () => {
    const s = summarizeIngestOutcomes(buildIngestOutcomes({
      ...base,
      sticker: { generation_status: "GENERATING" },
      ledger: [
        { step: "oem_brochure", status: "skipped", reason: "Make not supported by any OEM source." },
        { step: "owners_manual", status: "succeeded", reason: "Linked to the official manual." },
      ],
    }));
    expect(s).toMatchObject({ confirmed: 1, inferred: 0, running: 1, skipped: 1, needsAttention: 0 });
    expect(s.headline).toBe("1 of 3 confirmed, 1 in progress, 1 not applicable.");
  });
});
