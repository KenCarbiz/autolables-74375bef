// @vitest-environment node
// (pdf-lib's runtime type checks compare against Node-realm Uint8Array/
// ArrayBuffer; under the default jsdom environment those globals differ and
// every PDFDocument.load rejects.)
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";

// Golden harness for the official government form templates (Phase 6 of the
// compliance build). Three layers of pinning:
//
//   1. Golden bytes — the SHA-256 of every template in /public/forms is pinned
//      here AND must equal the hash seeded into compliance_form_templates by
//      the registry migration AND the fallback version stamped in the edge
//      function. Anyone swapping a government form file (new revision, wrong
//      upload, corruption) fails this suite until the registry, the code, and
//      the goldens are updated together — which is exactly the review moment a
//      form-revision change requires.
//   2. Field contract — every AcroForm field name and radio export value the
//      generate-vehicle-forms fill code writes must exist in the actual PDF.
//      A template that "looks the same" but renamed its fields dies here, not
//      in production with silently empty government forms.
//   3. Fill behavior — the fill semantics (correct front page kept, values
//      land, flatten succeeds, overlay page geometry unchanged) are executed
//      for real against the real templates with pdf-lib, the same library the
//      edge function uses.

const ROOT = join(__dirname, "../../..");
const FORMS = join(ROOT, "public/forms");
const MIGRATIONS = join(ROOT, "supabase/migrations");
const EDGE_SRC = readFileSync(join(ROOT, "supabase/functions/generate-vehicle-forms/index.ts"), "utf8");

const REGISTRY_VERSION = "2026.07.1";
const GOLDEN: Record<string, { key: string; sha256: string; pages: number }> = {
  "ftc-buyers-guide-en.pdf": {
    key: "ftc-buyers-guide-en",
    sha256: "532e7887b9e5180800952ad53cc75ac43c7d84e42b2fc318ef33ae2760dd9769",
    pages: 3,
  },
  "ftc-buyers-guide-es.pdf": {
    key: "ftc-buyers-guide-es",
    sha256: "04c56ea52392601b9fb594ae838b95e1b3ec2513db9967a5a7d5101ccd0d3aaa",
    pages: 3,
  },
  "k208-inspection.pdf": {
    key: "ct-k208",
    sha256: "95477857966141315778fc97714fe9020dc2af6adf1b8b2465268ab93274429c",
    pages: 1,
  },
};

const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");
const templateRaw = (name: string) => readFileSync(join(FORMS, name));
// pdf-lib's runtime type check fails on Node Buffers under the jsdom test
// environment (cross-realm Uint8Array), so hand it a plain ArrayBuffer.
const templateBytes = (name: string): ArrayBuffer => {
  const buf = templateRaw(name);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
};

function latestRegistryMigration(): string {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  let hit = "";
  for (const file of files) {
    const text = readFileSync(join(MIGRATIONS, file), "utf8");
    if (/INSERT INTO public\.compliance_form_templates/.test(text)) hit = text;
  }
  if (!hit) throw new Error("no migration seeds compliance_form_templates");
  return hit;
}

describe("golden template bytes (G1)", () => {
  for (const [file, g] of Object.entries(GOLDEN)) {
    it(`${file} is byte-identical to the pinned official revision`, () => {
      expect(sha256(templateRaw(file))).toBe(g.sha256);
    });
  }

  it("the registry migration seeds exactly these hashes at this version", () => {
    const sql = latestRegistryMigration();
    for (const [, g] of Object.entries(GOLDEN)) {
      expect(sql).toContain(`'${g.key}'`);
      expect(sql).toContain(`'${g.sha256}'`);
    }
    expect(sql).toContain(`'${REGISTRY_VERSION}'`);
  });

  it("the edge function's fallback version matches the registry version", () => {
    expect(EDGE_SRC).toContain(`FALLBACK_TEMPLATE_VERSION = "${REGISTRY_VERSION}"`);
  });

  it("the edge function verifies the fetched template hash against the registry", () => {
    expect(EDGE_SRC).toContain('from("compliance_form_templates")');
    expect(EDGE_SRC).toContain("template drift");
  });
});

describe("FTC Buyers Guide EN — AcroForm field contract (G2)", () => {
  const load = () => PDFDocument.load(templateBytes("ftc-buyers-guide-en.pdf"));

  it("has the 3 official pages at letter size", async () => {
    const pdf = await load();
    expect(pdf.getPageCount()).toBe(GOLDEN["ftc-buyers-guide-en.pdf"].pages);
    for (const p of pdf.getPages()) {
      expect(Math.round(p.getWidth())).toBe(612);
      expect(Math.round(p.getHeight())).toBe(792);
    }
  });

  it("carries every field the fill code writes, on both fronts and the back", async () => {
    const pdf = await load();
    const names = new Set(pdf.getForm().getFields().map((f) => f.getName()));
    const fronts = ["topmostSubform[0].BG-AsIs[0]", "topmostSubform[0].BG-Implied[0]"];
    for (const sub of fronts) {
      for (const leaf of ["VehicleMake[0]", "Model[0]", "Year[0]", "VIN[0]", "Warranty[0]", "DealerWarranty[0]", "Labor[0]", "Parts[0]", "Duration1[0]"]) {
        expect(names, `${sub}.${leaf}`).toContain(`${sub}.${leaf}`);
      }
    }
    // The five covered-systems lines are only ever written on the As-Is front
    // (box === 'warranty' implies implied === false).
    for (let i = 1; i <= 5; i++) {
      expect(names).toContain(`topmostSubform[0].BG-AsIs[0].SystemsCovered${i}[0]`);
    }
    for (const leaf of ["DealerName[0]", "DealerAddress[0]", "DealerPhone[0]", "DealerEmail[0]", "ComplaintContact[0]"]) {
      expect(names).toContain(`topmostSubform[0].BG-Back[0].${leaf}`);
    }
  });

  it("radio groups expose the exact export values the fill code selects", async () => {
    const pdf = await load();
    const form = pdf.getForm();
    for (const sub of ["BG-AsIs", "BG-Implied"]) {
      expect(form.getRadioGroup(`topmostSubform[0].${sub}[0].Warranty[0]`).getOptions()).toEqual(["As Is", "Dealer"]);
      expect(form.getRadioGroup(`topmostSubform[0].${sub}[0].DealerWarranty[0]`).getOptions()).toContain("Limited");
    }
  });

  it("fills, keeps only the As-Is front + back, and flattens", async () => {
    const pdf = await load();
    const form = pdf.getForm();
    const sub = "topmostSubform[0].BG-AsIs[0]";
    form.getTextField(`${sub}.VehicleMake[0]`).setText("HONDA");
    form.getTextField(`${sub}.Model[0]`).setText("CIVIC");
    form.getTextField(`${sub}.Year[0]`).setText("2022");
    form.getTextField(`${sub}.VIN[0]`).setText("2HGFE2F52NH100001");
    form.getRadioGroup(`${sub}.Warranty[0]`).select("As Is");
    form.getTextField("topmostSubform[0].BG-Back[0].DealerName[0]").setText("Golden Test Motors");
    pdf.removePage(1);
    form.flatten();
    const bytes = await pdf.save();
    expect(bytes.length).toBeGreaterThan(10_000);
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(2);
    expect(out.getForm().getFields().length).toBe(0);
  });
});

describe("FTC Buyers Guide ES — flat overlay geometry (G3)", () => {
  it("is the 3-page flat artwork at letter size — the measured overlay coordinates' frame", async () => {
    const pdf = await PDFDocument.load(templateBytes("ftc-buyers-guide-es.pdf"));
    expect(pdf.getPageCount()).toBe(GOLDEN["ftc-buyers-guide-es.pdf"].pages);
    for (const p of pdf.getPages()) {
      expect(Math.round(p.getWidth())).toBe(612);
      expect(Math.round(p.getHeight())).toBe(792);
    }
  });

  it("accepts the overlay draw + page removal the fill code performs", async () => {
    const pdf = await PDFDocument.load(templateBytes("ftc-buyers-guide-es.pdf"));
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const front = pdf.getPages()[0];
    front.drawText("HONDA", { x: 84, y: 643, size: 10, font });
    front.drawText("X", { x: 93, y: 577, size: 15, font: bold });
    pdf.removePage(1);
    const bytes = await pdf.save();
    expect(bytes.length).toBeGreaterThan(10_000);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  });
});

describe("CT K-208 — AcroForm field contract (G4)", () => {
  const load = () => PDFDocument.load(templateBytes("k208-inspection.pdf"));

  function vinFieldsFromEdgeSource(): string[] {
    const m = EDGE_SRC.match(/const K208_VIN_FIELDS = \[([^\]]+)\]/);
    if (!m) throw new Error("K208_VIN_FIELDS not found in generate-vehicle-forms");
    return m[1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
  }

  it("is a single letter-size page — the A/B/C initial coordinates' frame", async () => {
    const pdf = await load();
    expect(pdf.getPageCount()).toBe(GOLDEN["k208-inspection.pdf"].pages);
    const p = pdf.getPages()[0];
    expect(Math.round(p.getWidth())).toBe(612);
    expect(Math.round(p.getHeight())).toBe(792);
  });

  it("carries all 17 VIN boxes the fill code enumerates, plus header + dealer fields", async () => {
    const pdf = await load();
    const names = new Set(pdf.getForm().getFields().map((f) => f.getName()));
    const vinFields = vinFieldsFromEdgeSource();
    expect(vinFields.length).toBe(17);
    for (const f of vinFields) expect(names, f).toContain(f);
    for (const f of ["FillText1", "FillText6", "FillText29", "FillText2", "FillText4", "Text1", "Text2", "Text3", "Text4", "Text5", "Text6", "Text9", "Text10"]) {
      expect(names, f).toContain(f);
    }
  });

  it("fills the header + a 17-char VIN and flattens", async () => {
    const pdf = await load();
    const form = pdf.getForm();
    const vin = "2HGFE2F52NH100001";
    const vinFields = vinFieldsFromEdgeSource();
    vinFields.forEach((f, i) => form.getTextField(f).setText(vin[i] || ""));
    form.getTextField("FillText1").setText("2022");
    form.getTextField("Text1").setText("Golden Test Motors");
    form.flatten();
    const bytes = await pdf.save();
    expect(bytes.length).toBeGreaterThan(10_000);
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(1);
    expect(out.getForm().getFields().length).toBe(0);
  });
});

describe("idempotency contract in the migrations (G5)", () => {
  const sql = (() => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    return files.map((f) => readFileSync(join(MIGRATIONS, f), "utf8")).join("\n");
  })();

  it("one live compliance draft per (tenant, vehicle, type) is index-enforced", () => {
    expect(sql).toContain("ux_generated_documents_one_live_compliance_draft");
  });

  it("one pending K-208 per (tenant, vin) is index-enforced", () => {
    expect(sql).toContain("ux_safety_inspections_one_pending");
  });

  it("byte-identical archive artifacts are index-deduped", () => {
    expect(sql).toContain("ux_signed_document_archive_unique_artifact");
  });

  it("the edge function folds the insert race instead of erroring", () => {
    expect(EDGE_SRC).toContain('insErr.code === "23505"');
  });
});
