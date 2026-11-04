// Writes the owner-review evidence for the OEM catalog templates when
// OEM_TEMPLATES_EVIDENCE_DIR is set (trailing slash required, e.g.
// /mnt/project-files/window-sticker/oem-templates-28/): a sample package per
// template that has a layout, and the 28-row coverage matrix. Reads only
// fixtures and the reference PDFs; nothing is written to production.

import { describe, it } from "vitest";
import * as pdfLibModule from "pdf-lib";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildRenderLayout, fuelClassOf, type FactoryStickerRenderData, type FactoryStickerTheme } from "../render/contract";
import { realizePdf } from "../render/toPdf";
import { textBBox, type LayoutModel, type TextPrimitive } from "../render/layout";
import { expectNoTextOverlap } from "../render/__fixtures__/layoutAsserts";
import { referenceMatchData, tucsonListings, tucsonRenderData } from "../render/__fixtures__/tucson";
import { HYUNDAI_TUCSON_GAS_ID } from "../render/variants/hyundaiTucsonGas";
import { TEMPLATE_CATALOG, evaluateCatalogTemplate, type CatalogTemplate } from "../oem/templateCatalog";
import { CATALOG_LAYOUTS } from "../render/variants";

const DIR = process.env.OEM_TEMPLATES_EVIDENCE_DIR;
const theme: FactoryStickerTheme = {
  oemThemeId: "oem-sample", oemThemeVersion: "1", canonicalOemId: null, templateFamilyId: "sample",
  templateVersion: "1.0.0", logoAssetId: null, logoAssetVersion: null,
};

const sh = (cmd: string, args: string[]): string => execFileSync(cmd, args, { encoding: "utf8" });

interface PackageSpec {
  templateId: string;
  dirName: string;
  records: Array<{ label: string; data: FactoryStickerRenderData; referenceOnly: boolean }>;
  mappingMd: string;
  differencesMd: (t: CatalogTemplate) => string;
}

const TUCSON_MAPPING = `# Hyundai 2026 Tucson (gasoline) - data source mapping

Every printed value comes from the saved vehicle record the generator already reads (vehicle_listings.mc_attributes.build_sheet from NeoVIN, vehicle_listings.epa_economy from the verified fueleconomy.gov match, dealer_profiles.settings). No provider call is made. The reference sample's values (VIN 5NMJACDE3TH655783, MILLENNIUM HYUNDAI, NY126, prices, QR, barcode) are never used as defaults.

| Printed region | Source field | When missing |
|---|---|---|
| Reproduction banner and disclosure | reproduction.ts (REPRODUCTION_BANNER, REPRODUCTION_DISCLOSURE, provenance sentence) | Always printed |
| Hyundai logo | packaged artwork (logoArtwork.ts, owner-authorized 2026-11-01) | Always printed |
| Title (year model trim drivetrain) | identity from ymm + listing.trim; drivetrain from sourceCorrections.decideDrivetrain | Missing parts are omitted, never guessed |
| VIN (top left, top right, info box) | listing.vin | Always present |
| SOLD TO code + dealer lines | factoryCodes.dealer and dealer_profiles.settings, ONLY when dealerRole is original_delivery | Blank. The current selling rooftop never prints. The orchestrator does not set dealerRole today, so the block is blank on every generated sticker |
| Exterior / interior colour | build_sheet.colors.exterior / interior (name and code) | Row omitted |
| Transport | transportMethod (not on current records) | Row omitted |
| Emissions line | factoryCodes.emissions (not on current records) | Row omitted |
| Government 5-star safety panel | safety.* (NHTSA); nhtsaNotRated | Not Available (no verified NHTSA record), Not Rated (tested but unrated, or a category without a rating). Today the orchestrator adapter supplies no safety block, so every category reads Not Available |
| Standard features | build_sheet.standard + key_features through equipmentSelection (full list when it fits, else normalized selected lines plus the Passport pointer line) | Section omitted |
| Warranty section | warranty.* (verified OEM terms) | Omitted. Not wired in the adapter today |
| Added features (options, packages, port options) | build_sheet.options / packages (name, code, msrp) | A missing price prints N/A, an included item prints INCLUDED |
| Manufacturer's Suggested Retail Price | build_sheet.pricing.base_msrp | NOT AVAILABLE |
| Inland Freight & Handling | build_sheet.pricing.destination_charge | NOT AVAILABLE |
| Total Price | build_sheet.pricing.total_msrp (stated), else base + options + destination (computed); the document reconciliation status is MATCHED / MINOR_VARIATION / REVIEW_REQUIRED | NOT AVAILABLE |
| Fuel Economy MPG, city, highway | epa_economy.combined / city / highway (fueleconomy.gov match) | Whole panel shows the unavailable message; nothing is zero |
| Gallons per 100 miles | epa.gallonsPer100Miles, else 100 / combined | Omitted |
| Fuel type tag | epa_economy.fuelType through fuelCategoryLabel | Omitted |
| Small SUVs range note | epa.classNote (not on current records) | Omitted |
| You save / You spend over 5 years | epa.fiveYearCostDifference (not on current records) | Omitted (no average-vehicle assumption is invented) |
| Annual fuel cost | epa_economy.annualFuelCost | Omitted |
| Fuel Economy and GHG scale and pointer | epa_economy.ghgScore (integer 1-10) | "Not Available" in place of the scale; any value outside 1-10 is treated as unavailable |
| Smog scale and pointer | epa.smogScore (not on current records) | "Not Available" |
| CO2 sentence | epa_economy.co2TailpipeGpm | Omitted |
| Parts content, final assembly, engine / transmission origin | factory.partsContent (AALA), build_sheet.assembly | Heading with "Not available for this vehicle." Not on current records; never inferred from combined U.S./Canadian percentages or assembly country |
| VIN barcode | barcodePayload (= VIN), Code 128 regenerated per vehicle | Always present |
| Passport QR (0.90in including quiet zone) | passportUrl = canonicalPassportUrl(listing.slug) | Omitted with its caption when no Passport URL |
`;

const TUCSON_DIFFERENCES = (t: CatalogTemplate): string => `# Hyundai 2026 Tucson (gasoline) - differences from the OEM reference

Status: layout ${t.layoutStatus}, approval ${t.approval}. Production routing cannot select this template until the owner approves it.

## Blockers (stable codes)
${t.blockers.map((b) => `- ${b}`).join("\n")}

## Unresolved differences
- Fonts: Helvetica / Helvetica-Bold stand in for the reference's Helvetica and Univers LT Std / Std Bold (font_substitution). The EPA panel numerals in particular are lighter than the original.
- Layout compression: the reference runs from y=14pt to y=780pt. The reproduction banner (top) and disclosure (bottom) are mandatory, so vertical positions are compressed by 7% and the original's lower VIN line and the "Affix FULL Label" notice are not printed. Horizontal positions and box edges follow the reference.
- Artwork not reproduced: Hyundai Hope on Wheels logo and slogan, the car-diagram affix mark, EPA/DOT/agency seals, the source Smartphone QR (replaced by the Vehicle Passport QR), the source barcode (regenerated from the VIN).
- Monroney wording: the reference's "This label has been affixed ... 15 U.S.C. 1231" statement is replaced by "Original manufacturer's suggested retail prices shown. Excludes taxes, title, license, dealer-installed items and current selling price."
- EPA panel: the reference prints it as a scanned image. This is a native rebuild; gradient colours, bubble shape and spacing are approximated. The pointer sits at (score - 0.5) / 10 of the track, which is not measured from the original.
- EPA average-vehicle sentence: the reference's "average new vehicle gets 29 MPG and costs $8,500 ... $3.30 per gallon" figures are historical EPA assumptions, not on the record, so they are not printed; the footer uses the same wording as the approved Santa Fe master.
- Fields in the reference with no render-data source: MODEL code (85402A4S), PORT OF ENTRY, ACCESSORY WEIGHT, "316 A 1" production strip. Not printed. Adding them needs source evidence.
- OCR: transcribed text was spot-checked against the PDF only (ocr_unverified). The reference-match fixture normalizes "TM"/registered marks and drops the bullet asterisks on option names.
- Wireless Android Auto and Apple CarPlay, SHIFTRONIC and similar trademark marks are printed without the trademark glyphs (WinAnsi sanitation).
- Drivetrain text: records carry the NeoVIN value (for example 4WD) and the existing sourceCorrections rule decides the printed value; a Tucson AWD may print as the source states. Not changed here.
- Data not wired by the orchestrator adapter today (blockers nhtsa_ratings_not_wired, parts_content_not_wired, warranty_terms_not_wired): NHTSA stars read Not Available, the warranty section is omitted, the parts-content box shows its unavailable state, and smog and the 5-year cost comparison are unavailable. The reference-match render shows the fully populated state for comparison.
- Equipment: the NeoVIN standard list for these records holds 261-271 items. The one-page rule prints the ranked selection (about 167 lines at 5.5pt) with the fixed "Selected standard equipment shown. Scan for complete vehicle specifications." line. The reference prints a short OEM-curated list at 7pt.
- Equipment hygiene (catalog templates only): decoder fragments that are not equipment are dropped before selection, including IIHS rating rows ("... Rating-Poor"), speed-threshold clauses ("Operates Above 50 Kph/30 Mph"), "Includes/Activates ..." sub-clauses and autonomy-level labels. The approved masters keep their existing equipment path unchanged.
- The reference-match render passes passportUrl empty, so it has no Passport QR; the real-record renders show the QR.
`;

const packages: PackageSpec[] = [{
  templateId: HYUNDAI_TUCSON_GAS_ID,
  dirName: "hyundai-2026-tucson-gas",
  records: [],
  mappingMd: TUCSON_MAPPING,
  differencesMd: TUCSON_DIFFERENCES,
}];

const smallestFont = (m: LayoutModel): number =>
  Math.min(...m.pages.flatMap((p) => p.primitives.flatMap((x) => (x.kind === "text" ? [x.size] : []))));

const overlapResult = (m: LayoutModel): string => {
  try {
    expectNoTextOverlap(m, 0);
    return "pass";
  } catch (e) {
    return `fail: ${(e as Error).message}`;
  }
};

const outOfBounds = (m: LayoutModel): string[] =>
  m.pages[0].primitives.flatMap((p) => {
    if (p.kind === "text") {
      const b = textBBox(p as TextPrimitive);
      return b.x0 < 0 || b.x1 > m.width || b.y0 < 0 || b.y1 > m.height ? [(p as TextPrimitive).str] : [];
    }
    return [];
  });

async function writeSample(
  spec: PackageSpec, outDir: string, refPdf: string, data: FactoryStickerRenderData, label: string, referenceOnly: boolean,
): Promise<Record<string, unknown>> {
  const m = buildRenderLayout(data, theme, undefined, { sampleTemplateId: spec.templateId });
  if (!m.fit.ok) throw new Error(`${data.vin} did not fit: ${m.fit.detail}`);
  const name = referenceOnly ? "reference-match" : data.vin;
  const pdfPath = join(outDir, referenceOnly ? "reference-match.pdf" : `sticker-${data.vin}.pdf`);
  writeFileSync(pdfPath, await realizePdf(m, pdfLibModule as never));
  const pngBase = join(outDir, referenceOnly ? "reference-match-preview" : `preview-${data.vin}`);
  sh("pdftoppm", ["-r", "150", "-png", "-singlefile", pdfPath, pngBase]);
  const info = sh("pdfinfo", [pdfPath]);
  const size = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(info)!;
  const pages = Number(/Pages:\s+(\d+)/.exec(info)![1]);
  const qr = m.pages[0].primitives.find((p) => p.kind === "qr") as { size: number; payload: string } | undefined;
  const barcode = m.pages[0].primitives.find((p) => p.kind === "barcode") as { payload: string } | undefined;
  const p = data.pricing;
  const calculated = p.baseMsrp !== null ? p.baseMsrp + (p.optionsTotal ?? 0) + (p.destinationCharge ?? 0) : null;
  const refInfo = sh("pdfinfo", [refPdf]);
  const refSize = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(refInfo)!;
  return {
    name, label, referenceOnly, vin: data.vin,
    pages,
    pageSizePt: [Number(size[1]), Number(size[2])],
    pageSizeInches: [Number(size[1]) / 72, Number(size[2]) / 72],
    referencePageSizePt: [Number(refSize[1]), Number(refSize[2])],
    pageSizeEqualsReference: Number(size[1]) === Number(refSize[1]) && Number(size[2]) === Number(refSize[2]),
    smallestFontPt: smallestFont(m),
    equipment: m.fit.ok ? { scope: m.fit.equipmentScope, ...m.fit.equipmentCounts, fontPt: m.fit.equipmentFontPt } : null,
    passportQr: qr ? { sizeInches: qr.size / 72, payload: qr.payload } : null,
    barcodePayloadIsVin: barcode?.payload === data.vin,
    textOverlapCheck: overlapResult(m),
    textOutsidePage: outOfBounds(m),
    pricing: {
      baseMsrp: p.baseMsrp, factoryOptionsTotal: p.optionsTotal, destinationCharge: p.destinationCharge,
      calculatedTotal: calculated, printedTotal: p.totalMsrp,
      reconciled: calculated !== null && p.totalMsrp !== null && Math.abs(calculated - p.totalMsrp) <= 5,
      optionLines: data.options.length,
    },
  };
}

describe.skipIf(!DIR)("OEM template evidence", () => {
  it("writes the sample packages and the coverage matrix", async () => {
    const root = DIR!;
    const prod = JSON.parse(readFileSync(join(__dirname, "catalogProdCounts.fixture.json"), "utf8")) as {
      rows: Array<{ make: string; model: string; year: string; fuel: string; body: string; n: number }>;
    };
    const samplePath = new Map<string, string>();

    for (const spec of packages) {
      const outDir = join(root, "samples", spec.dirName) + "/";
      mkdirSync(outDir, { recursive: true });
      const t = TEMPLATE_CATALOG.find((x) => x.id === spec.templateId)!;
      const refSrc = join(root, "reference-pdfs", t.referencePdf);
      const refPdf = join(outDir, "reference.pdf");
      copyFileSync(refSrc, refPdf);
      const real = tucsonListings().map(tucsonRenderData);
      const matchData = referenceMatchData(real[0]);
      const results: Array<Record<string, unknown>> = [];
      for (const d of real) results.push(await writeSample(spec, outDir, refPdf, d, "real saved record", false));
      results.push(await writeSample(spec, outDir, refPdf, matchData, "reference-match (visual comparison only)", true));

      sh("pdftoppm", ["-r", "100", "-png", "-singlefile", refPdf, join(outDir, "_ref100")]);
      sh("pdftoppm", ["-r", "100", "-png", "-singlefile", join(outDir, "reference-match.pdf"), join(outDir, "_match100")]);
      sh("montage", [
        "-label", "OEM reference (original PDF)", join(outDir, "_ref100.png"),
        "-label", "AutoLabels reference-match render", join(outDir, "_match100.png"),
        "-tile", "2x1", "-geometry", "+12+12", "-pointsize", "26", join(outDir, "side-by-side.png"),
      ]);
      for (const f of ["_ref100.png", "_match100.png"]) sh("rm", ["-f", join(outDir, f)]);

      writeFileSync(join(outDir, "data-source-mapping.md"), spec.mappingMd);
      writeFileSync(join(outDir, "differences.md"), spec.differencesMd(t));
      writeFileSync(join(outDir, "verification.json"), JSON.stringify({
        template: t.id, rendererPath: "buildRenderLayout sampleTemplateId (pending approval; production routing excludes it)",
        generatedBy: "src/lib/factorySticker/__acceptance__/oemTemplateEvidence.test.ts",
        vehicles: results,
      }, null, 2));
      samplePath.set(t.id, `samples/${spec.dirName}/`);
    }

    const rows = TEMPLATE_CATALOG.map((t) => {
      let prodRecords = 0;
      for (const r of prod.rows) {
        const year = Number(r.year);
        const ev = evaluateCatalogTemplate(t, {
          make: r.make, modelYear: year, model: r.model, trim: null, bodyClass: r.body,
          fuelClass: fuelClassOf(r.fuel), drivetrain: null,
        });
        if (r.make.replace(/[^A-Z0-9]/g, "") === t.canonicalMake && ev.matched) prodRecords += r.n;

      }
      const m = t.match;
      return {
        template_id: t.id,
        brand: t.brand,
        source_vehicle: `${t.source.modelYear} ${t.source.model} ${t.source.trim}`,
        page_size: `${t.page.widthPt}x${t.page.heightPt}pt (${(t.page.widthPt / 72).toFixed(2)}x${(t.page.heightPt / 72).toFixed(2)}in) ${t.page.orientation}`,
        configuration_rule: `year ${m.modelYears.join("/")}; model /${m.modelPattern}/${m.excludedModelPattern ? ` not /${m.excludedModelPattern}/` : ""}; body ${m.bodyClasses.join("/")}; powertrain ${m.fuelClasses.join("/")}${m.drivetrains ? `; drive ${m.drivetrains.join("/")}` : ""}`,
        layout_status: t.layoutStatus,
        approval_state: t.approval,
        sample_path: samplePath.get(t.id) ?? "",
        blocker_codes: t.blockers.join(";"),
        has_layout_builder: Boolean(CATALOG_LAYOUTS[t.id]),
        existing_approved_master: t.existingMasterKey ?? "",
        prod_records: prodRecords,
      };
    });
    const header = Object.keys(rows[0]);
    const esc = (v: unknown): string => `"${String(v).replace(/"/g, '""')}"`;
    writeFileSync(join(root, "coverage-matrix.csv"), [header.join(","), ...rows.map((r) => header.map((h) => esc((r as Record<string, unknown>)[h])).join(","))].join("\n") + "\n");
    writeFileSync(join(root, "coverage-matrix.json"), JSON.stringify({
      generatedFrom: "src/lib/factorySticker/oem/templateCatalog.ts",
      prodRecordsNote: "Count of saved vehicle_listings rows (model years 2025-2026) that match the template's year, model, body and powertrain rule; read-only grouped SELECT on 2026-11-04. The Tucson count is the four 2026 Hyundai Tucson rows.",
      rows,
    }, null, 2));
  }, 120000);
});
