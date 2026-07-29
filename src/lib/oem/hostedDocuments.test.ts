import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Step 3 is the first code that fetches manufacturer bytes. These assert the
// two structural guarantees, because both are the kind of thing that reviews
// fine and fails quietly.

const ROOT = join(__dirname, "..", "..", "..");
const sql = readFileSync(join(ROOT, "supabase/migrations/20260729160000_oem_hosted_documents.sql"), "utf8");
const fn = readFileSync(join(ROOT, "supabase/functions/oem-document-store/index.ts"), "utf8");

describe("a stored copy cannot exist without a decision that authorised it", () => {
  it("requires every copy to cite a distribution event", () => {
    // NOT NULL against the evidence table means an unaccountable file cannot
    // be recorded even if the function calling this were wrong.
    expect(sql).toMatch(/authorised_by\s+UUID NOT NULL REFERENCES public\.oem_distribution_events\(id\)/);
  });

  it("claims before it fetches", () => {
    const claimAt = fn.indexOf("claim_oem_document_hosting");
    const fetchAt = fn.indexOf("await fetch(sourceUrl");
    expect(claimAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(-1);
    expect(claimAt).toBeLessThan(fetchAt);
  });

  it("returns without fetching when the dealer is not franchised", () => {
    expect(fn).toMatch(/if \(decision !== "host"\) \{/);
    expect(fn).toMatch(/reason: "not_franchised_for_brand"/);
  });

  it("refuses a host decision that carries no event to cite", () => {
    expect(fn).toMatch(/claim_missing_event/);
  });

  it("deletes the file when the copy cannot be recorded", () => {
    // An unaccountable file is worse than no file.
    expect(fn).toMatch(/storage\.from\(BUCKET\)\.remove\(\[path\]\)/);
  });
});

describe("storage is tenant-scoped, so possession never becomes permission", () => {
  it("writes under the tenant's own folder", () => {
    expect(fn).toMatch(/const path = `\$\{tenantId\}\//);
  });

  it("scopes the bucket read policy to the tenant's folder", () => {
    expect(sql).toMatch(/\(storage\.foldername\(name\)\)\[1\] IN \(/);
    expect(sql).toMatch(/SELECT tenant_id::text FROM public\.tenant_members/);
  });

  it("keys the held-copy lookup on tenant, brand, model and year", () => {
    // Without model and year this would hand back a Rogue manual for a
    // Pathfinder.
    expect(sql).toMatch(/lower\(h\.model\) = lower\(btrim\(coalesce\(_model, ''\)\)\)/);
    expect(sql).toMatch(/COALESCE\(h\.model_year, 0\) = COALESCE\(_model_year, 0\)/);
  });
});

describe("fetching is bounded and what comes back is checked", () => {
  it("streams with a running cap rather than buffering the whole body", () => {
    // arrayBuffer() on a 400 MB manual OOMs the worker before any size check
    // could fire.
    expect(fn).toMatch(/getReader\(\)/);
    expect(fn).toMatch(/if \(total > MAX_BYTES\)/);
    expect(fn).not.toMatch(/await res\.arrayBuffer\(\)/);
  });

  it("honours a declared content-length before reading a byte", () => {
    expect(fn).toMatch(/content-length/);
  });

  it("refuses anything that is not actually a PDF", () => {
    // A manufacturer bot-wall returns HTML with a 200. Storing that as "the
    // owner's manual" is worse than storing nothing.
    expect(fn).toMatch(/0x25 && bytes\[1\] === 0x50 && bytes\[2\] === 0x44 && bytes\[3\] === 0x46/);
    expect(fn).toMatch(/source_not_a_pdf/);
  });

  it("only ever fetches over https", () => {
    expect(fn).toMatch(/source_url_must_be_https/);
  });

  it("is service-role only, with no user-facing path to storing a byte", () => {
    expect(fn).toMatch(/if \(!isServiceOrCron\(req\)\) return json\(403/);
  });
});

describe("the passport keeps the manufacturer link either way", () => {
  const view = readFileSync(join(ROOT, "supabase/functions/public-listing-view/index.ts"), "utf8");

  it("serves the hosted copy only when the vehicle was entitled to one", () => {
    expect(view).toMatch(/oem_distribution_for_vehicle/);
    expect(view).toMatch(/if \(entitled !== "host"\) return null;/);
  });

  it("signs per request rather than storing a signed URL", () => {
    // A stored signed URL is what made published cars serve dead links once
    // it aged out.
    expect(view).toMatch(/createSignedUrl\(pick\.storage_path, 6 \* 60 \* 60\)/);
  });

  it("always carries the manufacturer URL, even when serving our copy", () => {
    expect(view).toMatch(/manufacturer_url: pick\.url/);
  });

  it("falls back to the link when the hosted lookup fails", () => {
    expect(view).toMatch(/url: held\?\.url \?\? pick\.url/);
  });
});
