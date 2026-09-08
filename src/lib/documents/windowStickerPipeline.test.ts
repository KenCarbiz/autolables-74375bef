import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// tsconfig.app.json includes only `src`, so nothing under supabase/ is
// typechecked and none of it runs in this suite. These assertions are the only
// guard the window-sticker pipeline has: they read the shipped source as text
// and pin the decisions that are easy to undo by accident.
//
// What they do NOT prove: that the edge functions run. Deno, pdf-lib, storage
// and the database are all unexercised here. Runtime behaviour is verified
// only in deployment.

const ROOT = join(__dirname, "../../..");
const FN = join(ROOT, "supabase/functions");
const MIGRATIONS = join(ROOT, "supabase/migrations");

const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function latestMigration(pattern: RegExp): string {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  let hit = "";
  for (const f of files) {
    const text = readFileSync(join(MIGRATIONS, f), "utf8");
    if (pattern.test(text)) hit = text;
  }
  if (!hit) throw new Error(`no migration matches ${pattern}`);
  return hit;
}

const norm = (sql: string) => sql.toLowerCase().replace(/--[^\n]*/g, "").replace(/\s+/g, " ");

describe("generate-vehicle-forms renders and files the window sticker", () => {
  const src = read("supabase/functions/generate-vehicle-forms/index.ts");

  it("renders the used-vehicle sheet from the shared content model", () => {
    expect(src).toContain("renderUsedCarStickerPdf");
    expect(src).toContain("buildUsedVehicleWindowSticker");
    expect(src).toContain("extractUsedStickerEquipment");
  });

  it("runs the window kind by default, so ingest needs no extra argument", () => {
    expect(src).toMatch(/const kinds = [^\n]*\["buyers_guide", "k208", "window"\]/);
  });

  it("files the sheet through the same keyed upsert as the forms", () => {
    expect(src).toMatch(/out\.window = await fileForm\(/);
    expect(src).toContain('"window", bytes');
  });

  it("files a new window version under the used-car-sticker template id", () => {
    expect(src).toContain('window: "used-car-sticker"');
    expect(src).toContain("TEMPLATE_ID_FOR[docType]");
  });

  it("only produces the sheet for a used vehicle", () => {
    expect(src).toMatch(/kinds\.includes\("window"\) && USED_CONDITIONS\.includes\(/);
  });
});

describe("the auto-publish step", () => {
  const src = read("supabase/functions/generate-vehicle-forms/index.ts");
  const fn = src.slice(src.indexOf("async function publishFiledDocument"), src.indexOf("const SWEEP_LOCK_KEY"));

  it("exists and is called for the sticker and the Buyers Guide", () => {
    expect(fn.length).toBeGreaterThan(200);
    expect(src).toContain('publishFiledDocument(admin, tenantId, listing.id as string, "window"');
    expect(src).toContain('publishFiledDocument(admin, tenantId, listing.id as string, "buyers_guide"');
  });

  it("can never reach the K-208, whose visibility gate is the service sign-off", () => {
    // enforce_k208_publish_requires_execution fails closed anyway; this keeps
    // the caller from ever asking.
    expect(src).not.toContain('publishFiledDocument(admin, tenantId, listing.id as string, "k208"');
    expect(fn).toContain('docType: "window" | "buyers_guide"');
  });

  it("names the document_type it moves, so it cannot reach another", () => {
    expect(fn).toContain('.eq("document_type", docType)');
  });

  it("is a compare-and-set out of draft, never an unconditional write", () => {
    expect(fn).toContain('.eq("document_status", "draft")');
  });

  it("refuses to re-publish over a manager rejection", () => {
    expect(fn).toContain('.eq("document_status", "rejected")');
    expect(fn).toContain("human_decision");
  });

  it("does not publish while the policy holds", () => {
    expect(fn).toMatch(/if \(holds\.length\) return "held";/);
  });
});

describe("the Buyers Guide publishes on a determined box, never a guessed one", () => {
  const src = read("supabase/functions/generate-vehicle-forms/index.ts");

  it("routes the decision through the pure policy module", () => {
    expect(src).toContain("evaluateBuyersGuideAutoPublish");
    expect(src).toContain("BUYERS_GUIDE_POLICY_VERSION");
  });

  it("re-snapshots the warranty representation on every fill", () => {
    // The drafted snapshot froze the box and its basis at first draft. A
    // published Guide has to record the statute or setting behind the bytes
    // that were actually filed.
    const branch = src.slice(src.indexOf('kinds.includes("buyers_guide")'), src.indexOf('kinds.includes("k208")'));
    expect(branch).toContain("forced: snap.forced");
    expect(branch).toContain("citation: snap.citation");
    expect(branch).toContain("default_ftc_warranty: snap.default_ftc_warranty");
    expect(branch).toContain("box_basis: bgDecision.basis");
  });

  it("treats an explicit box override as a human determination", () => {
    expect(src).toContain("boxOverride ? { ...snap, box: effBox, forced: true }");
  });
});

describe("filing stays separate from publishing", () => {
  const src = read("supabase/functions/generate-vehicle-forms/index.ts");

  it("still files every document as a draft", () => {
    // Publishing is a second, policy-gated step. fileForm itself never
    // publishes anything, so a document type added to it is private by default
    // rather than customer-visible by accident.
    const fileForm = src.slice(src.indexOf("async function fileForm"), src.indexOf("// ── What this function publishes"));
    expect(fileForm.length).toBeGreaterThan(500);
    expect(fileForm).toContain('document_status: "draft"');
    expect(fileForm).not.toContain('document_status: "published"');
  });

  it("files a Buyers Guide only against a used vehicle (16 CFR 455)", () => {
    // The Used Car Rule governs USED vehicles. This branch was the only path
    // with no condition test, and intake-autoprovision fires it for every new
    // listing, so new inventory collected drafted Buyers Guides.
    expect(src).toMatch(/kinds\.includes\("buyers_guide"\) && USED_CONDITIONS\.includes\(/);
  });
});

describe("the printed sheet is paper, not a themed card", () => {
  const src = read("supabase/functions/_shared/usedCarStickerPdf.ts");

  it("paints a literal white page and literal black ink", () => {
    expect(src).toContain("const WHITE = rgb(1, 1, 1)");
    expect(src).toContain("const BLACK = rgb(0, 0, 0)");
    expect(src).toMatch(/drawRectangle\(\{ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: WHITE \}\)/);
  });

  it("is 8.5x11 at 72dpi, matching PAPER.window", () => {
    expect(src).toContain("const PAGE_W = 612");
    expect(src).toContain("const PAGE_H = 792");
  });

  it("pins the PDF dates so identical content produces identical bytes", () => {
    // fileForm decides "same sticker" by SHA-256. A live clock in the PDF
    // Info dict would mint a new version on every nightly sweep.
    expect(src).toContain("pdf.setCreationDate(EPOCH)");
    expect(src).toContain("pdf.setModificationDate(EPOCH)");
  });
});

describe("the nightly sweep repairs a file-less window sticker", () => {
  const src = read("supabase/functions/_shared/complianceFormsSweep.ts");

  it("counts the window sticker as a form that must point at a file", () => {
    expect(src).toContain('export const FORM_KINDS = ["buyers_guide", "k208", "window"] as const;');
  });

  it("does not filter the worklist down to published listings", () => {
    // A vehicle held back by the recall gate is exactly the one that needs its
    // documents ready; `status = published` made it invisible here forever.
    expect(src).not.toContain('.eq("status", "published")');
    expect(src).toContain('.neq("status", "archived")');
  });

  it("re-renders a sticker whose printed price or odometer has drifted", () => {
    expect(src).toContain("driftsFromRecord");
  });

  it("recognises the pre-owned condition spellings a feed writes", () => {
    for (const c of ["used", "cpo", "certified", "pre-owned", "preowned"]) {
      expect(src).toContain(`"${c}"`);
    }
  });

  it("still tests for a file, not for row presence", () => {
    expect(src).toContain("if (!d.online_url && !d.pdf_url) return false;");
  });
});

describe("create_draft_window_sticker", () => {
  const body = norm(latestMigration(/CREATE OR REPLACE FUNCTION public\.create_draft_window_sticker/));

  it("uses the shared used-condition test, not a narrow literal list", () => {
    expect(body).toContain("if not public.is_used_condition(v_cond) then return null;");
  });

  it("reuses the live row instead of stacking a second draft", () => {
    expect(body).toContain("if v_existing is not null then return v_existing;");
    expect(body).toContain("exception when unique_violation then");
  });

  it("no longer tells the dealer to build the sticker by hand", () => {
    expect(body).not.toContain("before printing");
    expect(body).not.toContain("needs_verification");
  });

  it("stays service/member gated", () => {
    expect(body).toContain("perform public.assert_tenant_member_or_service(p_tenant_id)");
  });
});

describe("the intake sweep covers every used-condition spelling", () => {
  const body = norm(latestMigration(/CREATE OR REPLACE FUNCTION public\.sweep_missing_intake_drafts/));

  it("selects with is_used_condition", () => {
    expect(body).toContain("where public.is_used_condition(condition)");
  });

  it("still drafts the window sticker alongside the compliance documents", () => {
    expect(body).toContain("perform public.create_draft_window_sticker(r.tenant_id, r.vin)");
    expect(body).toContain("perform public.create_draft_buyers_guide(r.tenant_id, r.vin)");
  });

  it("stays cron-only", () => {
    expect(body).toContain("if (select auth.uid()) is not null then");
  });
});

describe("no edge function was left importing something it does not ship", () => {
  it("the used-sticker content model is mirrored into the edge tree", () => {
    const mirrored = join(FN, "_shared/factorySticker/lib/documents/usedVehicleWindowSticker.ts");
    const body = readFileSync(mirrored, "utf8");
    expect(body).toContain("GENERATED — do not edit");
    expect(body).toContain("export function buildUsedVehicleWindowSticker");
  });
});

describe("the factory sticker reaches vehicles the recall gate holds back", () => {
  const src = read("supabase/functions/factory-sticker-orchestrate/index.ts");

  it("sweeps on non-archived listings, not published ones", () => {
    expect(src).not.toContain('.eq("status", "published")');
    expect(src).toContain('.neq("status", "archived")');
  });

  it("still produces the OEM reproduction for used and CPO, not new only", () => {
    // families.ts marks the reproduction `supplemental` on a used vehicle and
    // eligibility.ts returns eligible_used_reproduction unless the dealership
    // opts out, so a used car gets the Monroney alongside its used-vehicle
    // sheet and its Buyers Guide.
    const eligibility = read("supabase/functions/_shared/factorySticker/lib/oem/eligibility.ts");
    expect(eligibility).toContain("eligible_used_reproduction");
    expect(eligibility).toContain("input.settings?.used_reproduction === false");
  });
});
