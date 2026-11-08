// Automatic vs manual generation parity. Both paths run factory-sticker-
// orchestrate's orchestrateVehicle: the automatic one from the ingest dispatch
// and the nightly sweep, the manual one from a dealer's regenerate with a
// recorded reason. For the same VIN, the same saved snapshot and the same
// renderer, both must route to the same layout and produce the same document.

import { describe, expect, it, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildListing, loadFixture, newStore, runOrchestrate, sha256,
  type Listing, type Outcome, type Store,
} from "./harness";
import { masterFor, productionLayoutKey, templateRoutingFacts } from "../render/contract";
import { TEMPLATE_CATALOG, type CatalogTemplate } from "../oem/templateCatalog";
import { tucsonListings } from "../render/__fixtures__/tucson";
import { recordListing } from "../render/__fixtures__/catalogRecord";
import { pinCatalogPending } from "../render/__fixtures__/catalogState";

const TUCSON_ID = "hyundai_2026_tucson_se_awd";

interface Signature {
  kind: Outcome["kind"];
  status: string;
  autoPublish: boolean;
  layout: string | null;
  flags: string[];
  pdfSha: string | null;
  pages: number | null;
  blockers: string[];
  reviewReason: string | null;
}

const signature = (o: Outcome): Signature => {
  const base = { kind: o.kind, status: o.status, autoPublish: o.autoPublish };
  if (o.kind === "pending_data" || o.kind === "ineligible" || o.kind === "selection_blocked") {
    return { ...base, layout: null, flags: [], pdfSha: null, pages: null, blockers: [], reviewReason: null };
  }
  return {
    ...base,
    layout: productionLayoutKey(o.normalized.data, o.plan.theme),
    flags: [...templateRoutingFacts(o.normalized.data).flags].sort(),
    pdfSha: o.rendered.pdfBytes.length ? sha256(o.rendered.pdfBytes) : null,
    pages: o.rendered.layout.pages,
    blockers: o.assessment.decision.blockers.map((b) => b.code).sort(),
    reviewReason: o.assessment.decision.reviewReason,
  };
};

const docState = (s: Store): string[] => s.docs.map((d) => `${d.version}:${d.document_status}:${d.content_hash}`);

/** Automatic (no reason) and manual (dealer regenerate with a reason) on separate, identically seeded stores. */
async function both(listing: Listing, seed?: (s: Store) => void): Promise<{ auto: Signature; manual: Signature; autoStore: Store; manualStore: Store }> {
  const autoStore = newStore();
  const manualStore = newStore();
  seed?.(autoStore);
  seed?.(manualStore);
  const auto = signature(await runOrchestrate(structuredClone(listing), autoStore));
  const manual = signature(await runOrchestrate(structuredClone(listing), manualStore, {
    regeneration: { reasonCode: "pdf_or_layout_problem" },
  }));
  return { auto, manual, autoStore, manualStore };
}

const tucson = (): Listing => tucsonListings()[0] as unknown as Listing;
const record = (file: string): Listing => recordListing(file) as unknown as Listing;

const fx = loadFixture();
const masterListing = (): Listing => {
  const v = fx.vehicles.find((x) => x.bs && x.e && /QX60/.test(x.y ?? ""))!;
  return buildListing(fx, v);
};

/** Simulates a future owner approval of one catalog entry inside this test only. */
function withApproval(id: string): () => void {
  const t = TEMPLATE_CATALOG.find((x) => x.id === id) as CatalogTemplate & { approval: string; layoutStatus: string };
  const prev = { approval: t.approval, layoutStatus: t.layoutStatus };
  t.approval = "approved";
  t.layoutStatus = "approved";
  return () => { t.approval = prev.approval; t.layoutStatus = prev.layoutStatus; };
}

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });

describe("automatic and manual generation produce the same document for the same snapshot", () => {
  pinCatalogPending();

  it("approved make-wide master: same master layout, same PDF", { timeout: 120_000 }, async () => {
    const l = masterListing();
    const { auto, manual } = await both(l);
    expect(manual).toEqual(auto);
    expect(auto.layout).toBe("infiniti-2026-qx60-sport-awd");
    expect(auto.pdfSha).not.toBeNull();
  });

  it("pending catalog template: never selected by either path; generic layout with the pending flag", { timeout: 120_000 }, async () => {
    const { auto, manual } = await both(tucson());
    expect(manual).toEqual(auto);
    expect(auto.layout).toBeNull();
    expect(auto.flags).toContain("template_pending_owner_approval");
    expect(TEMPLATE_CATALOG.find((t) => t.id === TUCSON_ID)!.approval).toBe("pending_owner_approval");
  });

  it("approved catalog template (simulated approval inside this test only): both paths route to it", { timeout: 120_000 }, async () => {
    const pending = await both(tucson());
    restore = withApproval(TUCSON_ID);
    const { auto, manual } = await both(tucson());
    expect(manual).toEqual(auto);
    expect(auto.layout).toBe(TUCSON_ID);
    expect(auto.flags).toEqual([]);
    // Checked against the template's own 17x11 page, and the wordmark logo counts as the printed make.
    expect(auto.blockers).toEqual([]);
    expect(auto.autoPublish).toBe(true);
    expect(auto.pdfSha).not.toBe(pending.auto.pdfSha);
  });

  it("unsupported configuration: generic layout, template_configuration_unsupported kept", { timeout: 120_000 }, async () => {
    const l = record("f250Record.fixture.json");
    const { auto, manual } = await both(l);
    expect(manual).toEqual(auto);
    expect(auto.layout).toBeNull();
    expect(auto.flags).toContain("template_configuration_unsupported");
  });

  it("missing build: both park PENDING_DATA and file nothing", async () => {
    const l = tucson();
    delete (l.mc_attributes as Record<string, unknown>).build_sheet;
    const { auto, manual, autoStore, manualStore } = await both(l);
    expect(manual).toEqual(auto);
    expect(auto.kind).toBe("pending_data");
    expect(autoStore.docs).toHaveLength(0);
    expect(manualStore.docs).toHaveLength(0);
  });

  it("MSRP discrepancy: both hold the document with the same reconciliation reason; neither publishes", { timeout: 120_000 }, async () => {
    const l = record("wranglerRecord.fixture.json");
    const { auto, manual } = await both(l);
    expect(manual).toEqual(auto);
    expect(auto.autoPublish).toBe(false);
    expect(auto.status).toBe("REVIEW_REQUIRED");
    expect(auto.blockers.some((c) => /msrp|reconcil/i.test(c))).toBe(true);
  });

  it("EPA conflict: both hold the document with the same conflict reason", { timeout: 120_000 }, async () => {
    const l = record("genesisRecord.fixture.json");
    const { auto, manual } = await both(l);
    expect(manual).toEqual(auto);
    expect(auto.kind).toBe("filed");
    expect(auto.autoPublish).toBe(false);
    expect(auto.blockers).toContain("epa_match_conflict");
  });

  it("unavailable regulatory data: no EPA or NHTSA figures invented on either path", { timeout: 120_000 }, async () => {
    const l = tucson();
    l.epa_economy = null;
    const a = await runOrchestrate(structuredClone(l), newStore());
    const m = await runOrchestrate(structuredClone(l), newStore(), { regeneration: { reasonCode: "additional_source_data_available" } });
    expect(signature(m)).toEqual(signature(a));
    if (a.kind === "filed") {
      expect(a.normalized.data.epa).toBeNull();
      expect(a.rendered.layout.drawnStrings.join(" ")).not.toMatch(/\bMPG\b/);
      expect(a.autoPublish).toBe(false);
      expect(a.assessment.decision.blockers.map((b) => b.code)).toContain("epa_record_missing");
    }
    expect(a.kind).toBe("filed");
  });

  it("superseded and published history: both paths leave the same document states", { timeout: 120_000 }, async () => {
    const seed = (s: Store): void => {
      s.docs.push(
        { id: "doc-old", version: 1, document_status: "superseded", content_hash: "old", superseded_by: "doc-pub", pdfBytes: new Uint8Array(0), regeneration_reason_code: null, generated_by: "system" },
        { id: "doc-pub", version: 2, document_status: "published", content_hash: "pub", superseded_by: null, pdfBytes: new Uint8Array(0), regeneration_reason_code: null, generated_by: "system" },
      );
      s.nextId = 3;
      s.record = { generation_status: "PUBLISHED", review_required: false, review_reason: null, current_document_id: "doc-pub" };
    };
    const held = record("wranglerRecord.fixture.json");
    const { auto, manual, autoStore, manualStore } = await both(held, seed);
    expect(manual).toEqual(auto);
    expect(docState(manualStore)).toEqual(docState(autoStore));
    // A held regeneration never replaces the document a customer is looking at.
    expect(autoStore.docs.find((d) => d.id === "doc-pub")!.document_status).toBe("published");
  });
});

describe("the automatic path never regenerates a settled sticker", () => {
  pinCatalogPending();

  const index = readFileSync(join(__dirname, "../../../../supabase/functions/factory-sticker-orchestrate/index.ts"), "utf8");
  const ingest = readFileSync(join(__dirname, "../../../../supabase/functions/ingest-orchestrate/index.ts"), "utf8");
  const setOf = (src: string, name: string): string[] => {
    const m = src.match(new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]`));
    return m ? [...m[1].matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]) : [];
  };

  it("the nightly sweep skips PUBLISHED, APPROVED and SUPERSEDED records", () => {
    const never = setOf(index, "SWEEP_NEVER_RERUN_STATUSES");
    expect(never).toEqual(expect.arrayContaining(["PUBLISHED", "APPROVED", "SUPERSEDED"]));
    for (const s of ["PUBLISHED", "APPROVED", "SUPERSEDED"]) {
      expect(setOf(index, "SWEEP_RETRYABLE_STATUSES")).not.toContain(s);
    }
  });

  it("the ingest dispatch only re-runs records parked without a document", () => {
    const retry = setOf(ingest, "STICKER_RETRYABLE");
    expect(retry.length).toBeGreaterThan(0);
    for (const s of ["PUBLISHED", "APPROVED", "SUPERSEDED", "REVIEW_REQUIRED"]) expect(retry).not.toContain(s);
  });

  it("no pending catalog template is reachable by production routing", () => {
    for (const t of TEMPLATE_CATALOG) expect(t.approval === "approved" && t.layoutStatus === "approved").toBe(false);
    expect(masterFor({ identity: { make: "HYUNDAI" }, epa: { fuelType: "Regular" } })).toBeNull();
  });
});
