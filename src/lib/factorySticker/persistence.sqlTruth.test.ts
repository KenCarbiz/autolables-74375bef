import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// One-truth harness over the factory sticker persistence layer: the CHECK
// widenings, the raw provider capture, the operational records table, its
// transition guard, and the listing-archive trigger. A later migration that
// weakens any of these fails CI instead of silently disconnecting the
// factory sticker pipeline.

const MIGRATIONS = join(__dirname, "../../../supabase/migrations");
const FUNCTIONS = join(__dirname, "../../../supabase/functions");

function latestText(pattern: RegExp): string {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  let hit = "";
  for (const file of files) {
    const text = readFileSync(join(MIGRATIONS, file), "utf8");
    if (pattern.test(text)) hit = text;
  }
  if (!hit) throw new Error(`no migration matches ${pattern}`);
  return hit;
}

const norm = (sql: string) =>
  sql.toLowerCase().replace(/--[^\n]*/g, "").replace(/\s+/g, " ");

const STATES = [
  "PENDING_DATA", "NORMALIZING", "VALIDATING", "REVIEW_REQUIRED",
  "READY_TO_GENERATE", "GENERATING", "RUNNING_QA", "APPROVED",
  "PUBLISHED", "FAILED_RETRYABLE", "FAILED_PERMANENT",
  "SUPERSEDED", "ARCHIVED",
];

describe("document type CHECK widenings (F1)", () => {
  it("the newest generated_documents document_type CHECK includes factory_sticker without dropping the existing types", () => {
    const body = norm(latestText(/generated_documents_document_type_check/));
    // scope to the CHECK expression itself
    const check = body.slice(body.lastIndexOf("generated_documents_document_type_check"));
    for (const t of ["window", "addendum", "passport", "cpo_sheet", "buyers_guide", "k208", "factory_sticker"]) {
      expect(check, t).toContain(`'${t}'`);
    }
  });

  it("the newest signed_document_archive doc_type CHECK includes factory_sticker without dropping the existing types", () => {
    const body = norm(latestText(/signed_document_archive_doc_type_check/));
    const check = body.slice(body.lastIndexOf("signed_document_archive_doc_type_check"));
    for (const t of ["addendum", "deal", "sticker", "buyers_guide", "prep_signoff", "disclosure", "k208", "factory_sticker"]) {
      expect(check, t).toContain(`'${t}'`);
    }
  });
});

describe("neovin_snapshots — complete raw provider capture (F2)", () => {
  const sql = latestText(/CREATE TABLE IF NOT EXISTS public\.neovin_snapshots/);
  const body = norm(sql);

  it("stores the full untouched payload with RLS enabled and NO client policies at all", () => {
    expect(body).toContain("payload jsonb not null");
    expect(body).toContain("alter table public.neovin_snapshots enable row level security");
    // Service-role only: not a single CREATE POLICY may target the table.
    expect(body).not.toMatch(/create policy [^;]*on public\.neovin_snapshots/);
  });

  it("dedupes identical re-pulls on (tenant_id, vin, payload_hash)", () => {
    expect(body).toMatch(/create unique index [^;]*on public\.neovin_snapshots \(tenant_id, vin, payload_hash\)/);
  });

  it("is queryable per tenant+vin, newest first", () => {
    expect(body).toMatch(/on public\.neovin_snapshots \(tenant_id, vin, fetched_at desc\)/);
  });
});

describe("marketcheck-specs — capture first, extract second (F3)", () => {
  const src = readFileSync(join(FUNCTIONS, "marketcheck-specs/index.ts"), "utf8")
    // structuredSheet now lives in _shared/neovinSheet.ts so the sticker
    // orchestrator can rehydrate from a stored snapshot instead of re-buying
    // a decode. These assertions follow the code.
    + readFileSync(join(FUNCTIONS, "_shared/neovinSheet.ts"), "utf8");

  it("persists the raw payload into neovin_snapshots BEFORE extraction runs", () => {
    const capture = src.indexOf('from("neovin_snapshots")');
    // the extraction pass over the winning payload
    const extract = src.indexOf("extractLists(payload)");
    const sheet = src.indexOf("structuredSheet(payload)");
    expect(capture).toBeGreaterThan(-1);
    expect(extract).toBeGreaterThan(-1);
    expect(sheet).toBeGreaterThan(-1);
    expect(capture).toBeLessThan(extract);
    expect(capture).toBeLessThan(sheet);
  });

  it("capture is dedupe-safe and error-swallowing so it can never fail the decode", () => {
    expect(src).toContain('onConflict: "tenant_id,vin,payload_hash"');
    expect(src).toContain("ignoreDuplicates: true");
    expect(src).toMatch(/catch \{ \/\* capture is best-effort/);
  });

  it("widened build_sheet persists the sticker-grade fields (pricing, codes, colors, assembly)", () => {
    expect(src).toContain("base_msrp");
    expect(src).toContain("destination_charge");
    expect(src).toContain("total_msrp");
    // per-item factory option codes on both packages and options
    expect(src).toMatch(/packages: \{ name: string; code\?: string; msrp\?: number; contents: string\[\] \}\[\]/);
    expect(src).toMatch(/options: \{ name: string; code\?: string; msrp\?: number \}\[\]/);
    expect(src).toContain("exterior_color");
    expect(src).toContain("interior_color");
    expect(src).toContain("made_in");
  });
});

describe("factory_sticker_records — operational state machine (F4)", () => {
  const sql = latestText(/CREATE TABLE IF NOT EXISTS public\.factory_sticker_records/);
  const body = norm(sql);

  it("declares all 13 generation states in the CHECK constraint", () => {
    for (const s of STATES) expect(body).toContain(`'${s.toLowerCase()}'`);
  });

  it("is one row per (tenant, vehicle) with tenant-scoped read-only RLS in the canonical shape", () => {
    expect(body).toContain("unique (tenant_id, vehicle_id)");
    expect(body).toContain("alter table public.factory_sticker_records enable row level security");
    expect(body).toContain("for select to authenticated");
    expect(body).toContain("(select auth.uid())");
    expect(body).toContain("accepted_at is not null");
    // No client write policy — writes only via service role / SECURITY DEFINER.
    expect(body).not.toMatch(/for (all|insert|update|delete)\s+to authenticated/);
  });

  it("keys the document pointer safely and indexes the operational queries", () => {
    expect(body).toContain("references public.generated_documents(id) on delete set null");
    expect(body).toContain("on public.factory_sticker_records (tenant_id, generation_status)");
    expect(body).toContain("on public.factory_sticker_records (tenant_id, vin)");
  });
});

describe("factory_sticker_transition_guard — terminal-state truth (F5)", () => {
  const sql = latestText(/CREATE OR REPLACE FUNCTION public\.factory_sticker_transition_guard/);
  const body = norm(sql);

  it("FAILED_PERMANENT only exits to ARCHIVED or an explicit PENDING_DATA reingest", () => {
    expect(body).toContain(
      "old.generation_status = 'failed_permanent' and new.generation_status not in ('archived','pending_data')",
    );
  });

  it("SUPERSEDED is fully terminal", () => {
    expect(body).toContain("old.generation_status = 'superseded' then raise exception");
  });

  it("ARCHIVED only revives to PENDING_DATA", () => {
    expect(body).toContain(
      "old.generation_status = 'archived' and new.generation_status <> 'pending_data'",
    );
  });

  it("is wired as a BEFORE UPDATE row trigger on the records table", () => {
    expect(body).toContain("before update on public.factory_sticker_records");
    expect(body).toContain("execute function public.factory_sticker_transition_guard()");
  });
});

describe("listing archive/delete → record ARCHIVED (F6)", () => {
  const sql = latestText(/CREATE OR REPLACE FUNCTION public\.factory_sticker_on_listing_archive/);
  const body = norm(sql);

  it("marks the record ARCHIVED on listing archive and on delete, skipping terminal rows", () => {
    expect(body).toContain("set generation_status = 'archived'");
    expect(body).toContain("generation_status not in ('archived','superseded')");
    expect(body).toContain("new.status = 'archived' and old.status is distinct from 'archived'");
  });

  it("swallows its own errors — sticker bookkeeping never breaks a listing write", () => {
    const fn = body.slice(body.indexOf("function public.factory_sticker_on_listing_archive"));
    expect(fn).toContain("exception when others then null");
  });

  it("is wired to both the status update and the delete on vehicle_listings", () => {
    expect(body).toContain("after update of status on public.vehicle_listings");
    expect(body).toContain("before delete on public.vehicle_listings");
  });
});
