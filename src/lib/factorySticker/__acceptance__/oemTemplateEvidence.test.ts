// Writes the owner-review evidence for the OEM catalog templates when
// OEM_TEMPLATES_EVIDENCE_DIR is set (trailing slash required, e.g.
// /mnt/project-files/window-sticker/oem-templates-28/): a sample package per
// template that has a layout, and the 28-row coverage matrix. Reads only
// fixtures and the reference PDFs; nothing is written to production.

import { describe, it } from "vitest";
import * as pdfLibModule from "pdf-lib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildRenderLayout, fuelClassOf, type FactoryStickerRenderData, type FactoryStickerTheme } from "../render/contract";
import { realizePdf } from "../render/toPdf";
import { textBBox, type LayoutModel, type TextPrimitive } from "../render/layout";
import { expectNoTextOverlap } from "../render/__fixtures__/layoutAsserts";
import { referenceMatchData, tucsonListings, tucsonRenderData } from "../render/__fixtures__/tucson";
import { wranglerReferenceMatchData, wranglerRenderData } from "../render/__fixtures__/wrangler";
import { voyagerReferenceMatchData, voyagerRenderData } from "../render/__fixtures__/voyager";
import { outlanderSportReferenceMatchData, outlanderSportRenderData } from "../render/__fixtures__/outlanderSport";
import { sorentoReferenceMatchData, sorentoRenderData } from "../render/__fixtures__/sorento";
import { foresterReferenceMatchData, foresterRenderData } from "../render/__fixtures__/forester";
import { gv80ReferenceMatchData, gv80RenderData } from "../render/__fixtures__/gv80";
import { durangoReferenceMatchData, durangoRenderData } from "../render/__fixtures__/durango";
import { envistaReferenceMatchData, envistaRenderData } from "../render/__fixtures__/envista";
import { f250ReferenceMatchData, f250RenderData } from "../render/__fixtures__/f250";
import { ram2500ReferenceMatchData, ram2500RenderData } from "../render/__fixtures__/ram2500";
import { silveradoReferenceMatchData, silveradoRenderData } from "../render/__fixtures__/silverado2500";
import { sierraReferenceMatchData, sierraRenderData } from "../render/__fixtures__/sierra3500";
import { FORD_F250_DIESEL_ID } from "../render/variants/fordF250Diesel";
import { RAM_2500_DIESEL_ID } from "../render/variants/ramLimitedDiesel";
import { CHEVROLET_SILVERADO_2500_DIESEL_ID } from "../render/variants/chevroletSilverado2500Diesel";
import { GMC_SIERRA_3500_DIESEL_ID } from "../render/variants/gmcSierra3500Diesel";
import { KIA_SORENTO_GAS_ID } from "../render/variants/kiaSorentoGas";
import { SUBARU_FORESTER_GAS_ID } from "../render/variants/subaruForesterGas";
import { GENESIS_GV80_GAS_ID } from "../render/variants/genesisGv80Gas";
import { DODGE_DURANGO_GAS_ID } from "../render/variants/dodgeDurangoGas";
import { BUICK_ENVISTA_GAS_ID } from "../render/variants/buickEnvistaGas";
import { CHRYSLER_VOYAGER_GAS_ID } from "../render/variants/chryslerVoyagerGas";
import { MITSUBISHI_OUTLANDER_SPORT_ID } from "../render/variants/mitsubishiOutlanderSport";
import { HYUNDAI_TUCSON_GAS_ID } from "../render/variants/hyundaiTucsonGas";
import { JEEP_WRANGLER_GAS_ID } from "../render/variants/jeepWranglerGas";
import { cadillacReferenceMatchData, cadillacRenderData } from "../render/__fixtures__/cadillac";
import { fiatReferenceMatchData, fiatRenderData } from "../render/__fixtures__/fiat";
import { spectreReferenceMatchData, spectreRenderData } from "../render/__fixtures__/spectre";
import { bentleyReferenceMatchData, bentleyRenderData } from "../render/__fixtures__/bentley";
import { urusReferenceMatchData, urusRenderData } from "../render/__fixtures__/lamborghini";
import { lexusReferenceMatchData, lexusRenderData } from "../render/__fixtures__/lexus";
import { toyota4runnerReferenceMatchData, toyota4runnerRenderData } from "../render/__fixtures__/toyota4runner";
import { volvoXc60ReferenceMatchData, volvoXc60RenderData } from "../render/__fixtures__/volvoXc60";
import { VOLVO_XC60_B5_ID } from "../render/variants/volvoXc60B5";
import { hondaOdysseyReferenceMatchData, hondaOdysseyRenderData } from "../render/__fixtures__/honda";
import { HONDA_ODYSSEY_GAS_ID } from "../render/variants/hondaOdysseyGas";
import { LEXUS_RX350_GAS_ID } from "../render/variants/lexusRx350Gas";
import { TOYOTA_4RUNNER_GAS_ID } from "../render/variants/toyota4runnerGas";
import { CADILLAC_ESCALADE_IQL_EV_ID } from "../render/variants/cadillacEscaladeIqEv";
import { FIAT_500E_EV_ID } from "../render/variants/fiat500eEv";
import { ROLLS_ROYCE_SPECTRE_EV_ID } from "../render/variants/rollsRoyceSpectreEv";
import { BENTLEY_CONTINENTAL_GT_PHEV_ID } from "../render/variants/bentleyContinentalGtPhev";
import { LAMBORGHINI_URUS_PHEV_ID } from "../render/variants/lamborghiniUrusPhev";
import { alfaReferenceMatchData, alfaRenderData } from "../render/__fixtures__/alfa";
import { ALFA_ROMEO_GIULIA_GAS_ID } from "../render/variants/alfaRomeoGiuliaGas";
import { maseratiReferenceMatchData, maseratiRenderData } from "../render/__fixtures__/maserati";
import { MASERATI_GRANTURISMO_GAS_ID } from "../render/variants/maseratiGranTurismoTrofeo";
import { lincolnReferenceMatchData, lincolnRenderData } from "../render/__fixtures__/lincoln";
import { LINCOLN_NAUTILUS_GAS_ID } from "../render/variants/lincolnNautilusGas";
import { astonReferenceMatchData, astonRenderData } from "../render/__fixtures__/aston";
import { ASTON_MARTIN_VANTAGE_ROADSTER_GAS_ID } from "../render/variants/astonMartinVantageRoadsterGas";
import { INFINITI_QX60_SPORT_ID } from "../render/variants/infinitiQx60Sport";
import { NISSAN_PATHFINDER_PLATINUM_ID } from "../render/variants/nissanPathfinderPlatinum";
import { pathfinderReferenceMatchData, qx60ReferenceMatchData } from "../render/__fixtures__/letterMasters";
import { NEW_TITLE, buildListing, loadFixture, passportUrlFor } from "./harness";
import { normalizeForSticker } from "../../../../supabase/functions/factory-sticker-orchestrate/normalize";
import { TEMPLATE_CATALOG, evaluateCatalogTemplate, type CatalogTemplate } from "../oem/templateCatalog";
import { CATALOG_LAYOUTS } from "../render/variants";

const DIR = process.env.OEM_TEMPLATES_EVIDENCE_DIR;
const theme: FactoryStickerTheme = {
  oemThemeId: "oem-sample", oemThemeVersion: "1", canonicalOemId: null, templateFamilyId: "sample",
  templateVersion: "1.0.0", logoAssetId: null, logoAssetVersion: null,
};

const execFileAsync = promisify(execFile);
const sh = async (cmd: string, args: string[]): Promise<string> => (await execFileAsync(cmd, args, { encoding: "utf8" })).stdout;

interface PackageSpec {
  templateId: string;
  dirName: string;
  build: () => { real: FactoryStickerRenderData[]; realLabel: string; reference: (first: FactoryStickerRenderData) => FactoryStickerRenderData };
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
| Government 5-star safety panel | NHTSA ratings via NeoVIN decode: the decoder's own rating rows (Overall, Frontal Crash, Side Impact, Rollover) in the standard and key-feature lists, used only when the "Standard-NHTSA" row is present; IIHS rows never feed stars. NeoVIN gives frontal and side as one value each, so the panel prints combined "Frontal Crash" and "Side Crash" rows and never copies the value into driver, passenger, front-seat or rear-seat rows. A saved NHTSA block (safety, nhtsaNotRated) takes precedence | Not Available for any category the decode lacks (and for all rows when there is no NHTSA row); Not Rated only when NHTSA states the vehicle is not rated |
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
| Parts content, final assembly, engine / transmission origin | factory.partsContent (AALA); country of final assembly from mc_attributes.made_in (printed as "COUNTRY OF FINAL ASSEMBLY: <country>", no plant or city invented); build_sheet.assembly city/plant when present | Heading with "Not available for this vehicle." when nothing is known. Parts-content percentages and engine / transmission origin are not on current records and stay unavailable; never inferred from the made-in country |
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
- NHTSA: stars come from the NeoVIN decode rating rows (combined frontal and side values, overall, rollover). The reference prints driver/passenger and front/rear-seat rows; the decode does not give them, so the combined rows print instead and nothing is split.
- Data not wired by the orchestrator adapter today (blockers parts_content_not_wired, warranty_terms_not_wired): the warranty section is omitted, parts-content percentages and engine/transmission origin are unavailable, and smog and the 5-year cost comparison are unavailable. The reference-match render shows the fully populated state for comparison.
- Other NeoVIN fields on the record: engine (2.5L I4), transmission, fuel_type (Unleaded), drivetrain and body type have no matching region on this reference except the standard-features list, which already carries the powertrain lines; the reference's MODEL: code row has no decode field. fuel_type does not fill the Gasoline Vehicle tag, which stays tied to the verified EPA match. Seating capacity appears only inside the equipment list.
- Equipment: the NeoVIN standard list for these records holds 261-271 items. The one-page rule prints the ranked selection (about 167 lines at 5.5pt) with the fixed "Selected standard equipment shown. Scan for complete vehicle specifications." line. The reference prints a short OEM-curated list at 7pt.
- Equipment hygiene (catalog templates only): decoder fragments that are not equipment are dropped before selection, including IIHS rating rows ("... Rating-Poor"), speed-threshold clauses ("Operates Above 50 Kph/30 Mph"), "Includes/Activates ..." sub-clauses and autonomy-level labels. The approved masters keep their existing equipment path unchanged.
- The reference-match render passes passportUrl empty, so it has no Passport QR; the real-record renders show the QR.
`;

const WRANGLER_MAPPING = `# Jeep 2026 Wrangler (gasoline) - data source mapping

Every printed value comes from the saved vehicle record the generator already reads (vehicle_listings.mc_attributes from NeoVIN, vehicle_listings.epa_economy from the verified fueleconomy.gov match, dealer_profiles.settings). No provider call is made. No vehicle value is a literal in the layout: only fixed labels, OEM boilerplate headings (including the jeep.com contact line) and the Jeep logo artwork are. The reference sample's values (VIN 1C4RJXSJ5TW323044, Willys 392, Anvil paint, prices, EPA figures, parts content, QR, barcode) appear only in the reference-match fixture, and a test renders an empty record to prove none leaks.

| Printed region | Source field | When missing |
|---|---|---|
| Reproduction banner and disclosure | reproduction.ts | Always printed |
| Jeep logo | packaged artwork (logoArtwork.ts, owner-authorized 2026-11-01) | Always printed |
| Model-year line | identity.year | Omitted |
| Title (model trim drivetrain) | identity from ymm + listing.trim; drivetrain from sourceCorrections.decideDrivetrain | Missing parts omitted, never guessed |
| Spec line, Exterior / Interior color | identity make, model, trim, drivetrain; build_sheet.colors | Row omitted |
| Engine, Transmission | mc_attributes.engine / transmission (or build_sheet.mechanical) | Row omitted |
| Base Price box, destination, total | build_sheet.pricing base_msrp, destination_charge, total_msrp (stated, else base + options + destination) | NOT AVAILABLE |
| Optional equipment (packages, options with price) | build_sheet.packages / options | Nothing listed; a missing price prints N/A, an included item INCLUDED |
| Standard equipment | build_sheet.standard + key_features through equipmentSelection and catalog hygiene (full list when it fits, else selected lines plus the Passport pointer line) | Unavailable line |
| Warranty coverage | warranty.* (verified OEM terms only) | "Not available for this vehicle." Not wired in the adapter today |
| Fuel Economy MPG, city, highway, gallons per 100 miles | epa_economy combined / city / highway; gallons from the record or 100 / combined | Panel shows the unavailable message; nothing is zero |
| Annual fuel cost | epa_economy.annualFuelCost | Not Available |
| You save / You spend over 5 years | epa.fiveYearCostDifference | "5-year fuel cost comparison: Not Available" |
| Greenhouse gas scale and pointer | epa_economy.ghgScore (integer 1-10) | Not Available; any value outside 1-10 is unavailable |
| Smog scale and pointer | epa.smogScore (not on current records) | Not Available |
| CO2 sentence | epa_economy.co2TailpipeGpm | Omitted |
| Fuel type tag | epa_economy.fuelType | Omitted |
| Government 5-star safety ratings | NHTSA ratings via NeoVIN decode (rating rows in the standard and key-feature lists, only when the Standard-NHTSA row is present; IIHS rows never feed stars). Combined Frontal Crash and Side Crash rows; never split into driver, passenger or seat rows. A saved NHTSA block takes precedence | Compact panel: "has not been rated by the government" when NHTSA states not rated, "not available from a verified NHTSA record" when there is no NHTSA row; otherwise Not Available per absent category |
| Parts content box | factory.partsContent (AALA); country of final assembly from mc_attributes.made_in; assembly city/plant when present | "Not available for this vehicle." |
| Original delivering dealer (SOLD TO) | dealer block, ONLY when dealerRole is original_delivery | Label printed blank. The current selling rooftop never prints. The orchestrator does not set dealerRole today |
| Assembly Point / Port of Entry | factory.finalAssemblyPoint | Omitted |
| VIN, VIN barcode | listing.vin; Code 128 regenerated per vehicle | Always present |
| Passport QR (0.90in including quiet zone) | canonicalPassportUrl(listing.slug) | Omitted with its caption when no Passport URL |
`;

const VOYAGER_MAPPING = `# Chrysler 2026 Voyager (gasoline) - data source mapping

Every printed value comes from the saved vehicle record the generator already reads (vehicle_listings.mc_attributes from NeoVIN, vehicle_listings.epa_economy from the verified fueleconomy.gov match, dealer_profiles.settings). No provider call is made. No vehicle value is a literal in the layout: only fixed labels, OEM boilerplate headings (including the chrysler.com contact line) and the Chrysler logo artwork are. The reference sample's values (VIN 1C4RJXSJ5TW323044, Willys 392, Anvil paint, prices, EPA figures, parts content, QR, barcode) appear only in the reference-match fixture, and a test renders an empty record to prove none leaks.

| Printed region | Source field | When missing |
|---|---|---|
| Reproduction banner and disclosure | reproduction.ts | Always printed |
| Chrysler logo | packaged artwork (logoArtwork.ts, owner-authorized 2026-11-01) | Always printed |
| Model year (stacked digits) and title (model trim) | identity from ymm + listing.trim | Missing parts omitted, never guessed |
| Spec line, Exterior / Interior color | identity make, model, trim; build_sheet.colors | Row omitted |
| Engine, Transmission | mc_attributes.engine / transmission (or build_sheet.mechanical) | Row omitted |
| Base Price box, destination, total | build_sheet.pricing base_msrp, destination_charge, total_msrp (stated, else base + options + destination) | NOT AVAILABLE |
| Optional equipment (packages, options with price) | build_sheet.packages / options; unpriced paint and trim entries that repeat the colour rows are not listed | Nothing listed; a missing price prints N/A, an included item INCLUDED |
| Standard equipment | build_sheet.standard + key_features through equipmentSelection and catalog hygiene (full list when it fits, else selected lines plus the Passport pointer line) | Unavailable line |
| Warranty coverage | warranty.* (verified OEM terms only) | "Not available for this vehicle." Not wired in the adapter today |
| Fuel Economy MPG, city, highway, gallons per 100 miles | epa_economy combined / city / highway; gallons from the record or 100 / combined | Panel shows the unavailable message; nothing is zero |
| Annual fuel cost | epa_economy.annualFuelCost | Not Available |
| You save / You spend over 5 years | epa.fiveYearCostDifference | "5-year fuel cost comparison: Not Available" |
| Greenhouse gas scale and pointer | epa_economy.ghgScore (integer 1-10) | Not Available; any value outside 1-10 is unavailable |
| Smog scale and pointer | epa.smogScore (not on current records) | Not Available |
| CO2 sentence | epa_economy.co2TailpipeGpm | Omitted |
| Fuel type tag | epa_economy.fuelType | Omitted |
| Government 5-star safety ratings | NHTSA ratings via NeoVIN decode (rating rows in the standard and key-feature lists, only when the Standard-NHTSA row is present; IIHS rows never feed stars). Combined Frontal Crash and Side Crash rows; never split into driver, passenger or seat rows. A saved NHTSA block takes precedence | Compact panel: "has not been rated by the government" when NHTSA states not rated, "not available from a verified NHTSA record" when there is no NHTSA row; otherwise Not Available per absent category |
| Parts content box | factory.partsContent (AALA); country of final assembly from mc_attributes.made_in; assembly city/plant when present | "Not available for this vehicle." |
| Original delivering dealer (SOLD TO) | dealer block, ONLY when dealerRole is original_delivery | Label printed blank. The current selling rooftop never prints. The orchestrator does not set dealerRole today |
| Assembly Point / Port of Entry | factory.finalAssemblyPoint | Omitted |
| VIN, VIN barcode | listing.vin; Code 128 regenerated per vehicle | Always present |
| Passport QR (0.90in including quiet zone) | canonicalPassportUrl(listing.slug) | Omitted with its caption when no Passport URL |
`;

const WRANGLER_DIFFERENCES = (t: CatalogTemplate): string => `# Jeep 2026 Wrangler (gasoline) - differences from the OEM reference

Status: layout ${t.layoutStatus}, approval ${t.approval}. Production routing cannot select this template until the owner approves it.

## Sample data
- reference-match: the reference sticker's own transcribed values, for side-by-side comparison only (reference VIN, prices, EPA figures, parts content). It is never used for another vehicle.
- sticker-1C4HJXDN4PW657311: off-year layout stress test (2023 record), not a production candidate. Production has no 2026 Wrangler. It is a 2023 Wrangler Altitude (used) with 173 equipment items and ten priced options; the template does not match it (year), so it renders only through the explicit sample path. The read-only extract (vin, slug, ymm, trim, condition, build_sheet, epa_economy, body_type) carries no engine, transmission, drivetrain or made_in fields, so those rows and the assembly line are omitted. Its stated total (51,225) does not equal base + options + destination (52,020) because the record's option list includes dealer-installed lines; the sticker prints the stated total and the lines as saved.

## Blockers (stable codes)
${t.blockers.map((b) => `- ${b}`).join("\n")}

## Unresolved differences
- Fonts: Helvetica / Helvetica-Bold stand in for the reference's Arial Narrow and Arial (font_substitution); the title and body text are wider than the original.
- Layout compression: vertical positions are compressed by 7% to clear the mandatory banner and disclosure. The olive frame is drawn as four bands with square inner corners.
- Artwork not reproduced: the FlexCare vehicle protection advertisement and the 5-year/60,000-mile powertrain warranty graphic, agency seals, the source Smartphone QR (replaced by the Vehicle Passport QR in the free area below the parts box), the source barcode (regenerated from the VIN), "FCA US LLC".
- Wording not reproduced: the reference's "THIS LABEL IS ADDED TO THIS VEHICLE TO COMPLY WITH FEDERAL LAW" statement and the "manufactured to meet specific United States requirements" statement (neither is certified here); the footnote is replaced by "Original manufacturer's suggested retail prices shown. Excludes taxes, title, license, dealer-installed items and current selling price."
- EPA panel: native rebuild of what the reference prints as a scanned image (epa_scale_scan_rebuilt); the 5-year cost comparison and "These estimates reflect new EPA methods" sentence are omitted when not on the record or for space; the average-vehicle MPG and cost sentence is not printed (not on the record).
- Safety: the decode gives one frontal and one side value, so combined rows print where the reference's full panel would show driver/passenger and front/rear seat; NHTSA often does not rate the Wrangler and the not-rated and not-available states are shown honestly.
- Fields in the reference with no render-data source: L4-VON, S.L., SHIP TO, the "Interior:" seat-material line, the production strip. Not printed.
- Optional equipment order: the reference lists the paint line before the package; packages print before options here.
- OCR: transcribed text was spot-checked against the PDF only (ocr_unverified). The reference-match fixture drops registered and trademark marks and normalizes en-dashes (WinAnsi sanitation).
- Drivetrain text: the title prints the decoded drivetrain (4WD) where the reference prints 4X4.
- Parts content, warranty: not wired by the orchestrator adapter today (blockers parts_content_not_wired, warranty_terms_not_wired); the reference-match render shows the populated state.
- Other NeoVIN fields: engine and transmission are printed in the specification rows; fuel_type does not fill the fuel tag (tied to the verified EPA match); seating capacity and version have no region on this reference.
- Equipment: the reference prints a short curated list at 9pt; the stress record prints its full 173 items at the ladder's compacted size. Decoder fragments (rating rows, speed thresholds) are dropped before selection.
- Matching: model names such as "Wrangler 4-Door" match; the 4xe is excluded by model, trim and plug-in fuel text. A record that states no drivetrain still matches; a stated non-4WD drivetrain does not. The 4xe plug-in is unsupported by this template and keeps its existing approved-master rendering.
`;

const VOYAGER_DIFFERENCES = (t: CatalogTemplate): string => `# Chrysler 2026 Voyager (gasoline) - differences from the OEM reference

Status: layout ${t.layoutStatus}, approval ${t.approval}. Production routing cannot select this template until the owner approves it.

## Sample data
- reference-match: the reference sticker's own transcribed values, for side-by-side comparison only (reference VIN, prices, EPA figures, safety stars, parts content). It is never used for another vehicle.
- sticker-2C4RC1CG6ER198366: off-year, other-model layout stress test (2014 Town & Country, used, 201 equipment items, three priced options). Production has no 2026 Voyager and no saved 2026 Chrysler record. The template does not match it (year and model), so it renders only through the explicit sample path.

## Blockers (stable codes)
${t.blockers.map((b) => `- ${b}`).join("\n")}

## Unresolved differences
- Fonts: Helvetica / Helvetica-Bold stand in for the reference's Arial Narrow and Arial (font_substitution); body text is wider than the original.
- Layout compression: vertical positions are compressed by 7% to clear the mandatory banner and disclosure. The blue frame is drawn as four bands.
- Artwork not reproduced: the FlexCare vehicle protection advertisement, the 5-year/60,000-mile powertrain warranty graphic, agency seals, the source Smartphone QR (replaced by the Vehicle Passport QR below the parts box), the source barcode (regenerated from the VIN) and the "FCA US LLC" legend.
- Wording not reproduced: "THIS VEHICLE IS MANUFACTURED TO MEET SPECIFIC UNITED STATES REQUIREMENTS" and "THIS LABEL IS ADDED TO THIS VEHICLE TO COMPLY WITH FEDERAL LAW" (neither is certified here). The footnote reads "Original manufacturer's suggested retail prices shown. Excludes taxes, title, license, dealer-installed items and current selling price."
- EPA panel: native rebuild with the same indicator semantics (1-10 scores, Not Available for anything else); gradient, bubble shape and spacing are approximated. The "These estimates reflect new EPA methods" sentence, the average-vehicle MPG and cost sentence and the pump icon are not printed.
- Safety: the decode gives one frontal and one side value, so combined rows print where the reference shows driver/passenger and front/rear seat; the reference-match fixture carries per-row values to show the full panel. Not-rated and not-available states are shown honestly.
- Fields in the reference with no render-data source: "Interior:" seat-material line, S.L., L4-VON, SHIP TO, the production strip. Not printed.
- Optional equipment: the reference prints the unpriced package heading with a priced kit beneath it; this layout prints a priced package line with its contents. Unpriced paint and trim entries that the decoder lists as options are not listed (the colour rows already print them).
- Title: the model-year digits are stacked as in the reference; the title prints model and trim from the record.
- OCR: transcription was spot-checked against the PDF only (ocr_unverified). The reference-match fixture drops registered and trademark marks and normalizes en-dashes (WinAnsi sanitation).
- Parts content, warranty: not wired by the orchestrator adapter today (blockers parts_content_not_wired, warranty_terms_not_wired); the reference-match render shows the populated state.
- Equipment: the reference-match render prints all 44 items; the stress record prints all 201 at the ladder's compacted size. Decoder fragments (rating rows, speed thresholds, bare counts and letters, engine and drive labels) are dropped before selection, for this template and the Outlander Sport template only.
- Matching: model Voyager, minivan body, gasoline only. The Pacifica and Pacifica Hybrid are not matched and flag template_configuration_unsupported; a stated drivetrain does not affect matching. The reference states no drivetrain.
- Data caveat: a production 2026 Voyager has not been observed, so the MarketCheck body label ("Minivan" on the saved Chrysler minivan record) and the EPA fuel-type text are confirmed only from other Chrysler minivans.
`;

const OUTLANDER_MAPPING = `# Mitsubishi 2026 Outlander Sport (gasoline) - data source mapping

Every printed value comes from the saved vehicle record the generator already reads (vehicle_listings.mc_attributes from NeoVIN, vehicle_listings.epa_economy from the verified fueleconomy.gov match, dealer_profiles.settings). No provider call is made. No vehicle value is a template default.

| Printed region | Source field | When missing |
|---|---|---|
| Reproduction banner and disclosure | reproduction.ts | Always printed |
| Mitsubishi logo | packaged artwork (logoArtwork.ts, owner-authorized 2026-11-01) | Always printed |
| Title (year model trim) | identity from ymm + listing.trim | Missing parts omitted, never guessed |
| Exterior / interior color line, engine, transmission, emissions, drivetrain | build_sheet.colors; mc_attributes.engine / transmission; drivetrain from sourceCorrections.decideDrivetrain | Row omitted |
| Emissions line | factoryCodes.emissions (not on current records) | Row omitted |
| Fuel economy MPG, city, highway, gallons per 100 miles | epa_economy combined / city / highway; gallons from the record or 100 / combined | Panel shows the unavailable message; nothing is zero |
| Annual fuel cost | epa_economy.annualFuelCost | Not Available |
| You save / You spend over 5 years | epa.fiveYearCostDifference | "5-year fuel cost comparison: Not Available" |
| Greenhouse gas scale and pointer | epa_economy.ghgScore (integer 1-10) | Not Available; any value outside 1-10 is unavailable |
| Smog scale and pointer | epa.smogScore (not on current records) | Not Available |
| CO2 sentence, fuel type tag, class range note | epa_economy.co2TailpipeGpm / fuelType; epa.classNote | Omitted |
| Government 5-star safety ratings | NHTSA ratings via NeoVIN decode (rating rows, only when the Standard-NHTSA row is present; IIHS rows never feed stars). Combined Frontal Crash and Side Crash rows; never split into driver/passenger or front/rear seat. | "Not Rated", or the not-available message when no verified record |
| Parts content box | factory.partsContent (AALA); country of final assembly from mc_attributes.made_in; assembly city/plant when present | "Not available for this vehicle." |
| Standard equipment | build_sheet.standard + key_features through equipmentSelection and catalog hygiene (full list when it fits, else selected lines plus the Passport pointer line) | Unavailable line |
| Additional equipment (packages, options with price) | build_sheet.packages / options | "None listed."; a missing price prints N/A, an included item INCLUDED |
| MSRP, total additional equipment, subtotal, destination/handling, total MSRP | build_sheet.pricing base_msrp, factory-installed total, destination_charge; total_msrp (stated), else base + options + destination | NOT AVAILABLE |
| Warranty coverage | warranty.* (verified OEM terms only) | "Not available for this vehicle." Not wired in the adapter today |
| Visit-us bar | fixed OEM web address | Always printed |
| Ship to (original delivering dealer) | dealer block, ONLY when dealerRole is original_delivery | Label printed blank. The current selling rooftop never prints. The orchestrator does not set dealerRole today |
| Plant / port of entry, method of transport | factory.finalAssemblyPoint, factory.transportMethod | Omitted |
| VIN, VIN barcode | listing.vin; Code 128 regenerated per vehicle | Always present |
| Passport QR (0.90in including quiet zone) | canonicalPassportUrl(listing.slug) | Omitted with its caption when no Passport URL |
`;

const OUTLANDER_DIFFERENCES = (t: CatalogTemplate): string => `# Mitsubishi 2026 Outlander Sport (gasoline) - differences from the OEM reference

Status: layout ${t.layoutStatus}, approval ${t.approval}. Production routing cannot select this template until the owner approves it.

## Sample data
- reference-match: the reference sticker's own transcribed values, for side-by-side comparison only (reference VIN, prices, EPA figures, safety stars, parts content). It is never used for another vehicle.
- sticker-JA4ATVAA3RZ023615: off-year, other-model layout stress test (2024 Eclipse Cross LE, used, 172 equipment items, two priced options). Production has no 2026 Outlander Sport. The template does not match it (year and model), so it renders only through the explicit sample path.

## Blockers (stable codes)
${t.blockers.map((b) => `- ${b}`).join("\n")}

## Unresolved differences
- Page: the reference PDF is an 11x17 sheet (792x1224pt, rotation 0) that stores a landscape label rotated 90 degrees (reference_stored_rotated). This layout is the upright 17x11 landscape page (1224x792pt) with the reference arrangement: logo and title block above the standard equipment on the left, additional equipment and the MSRP stack in the middle, then the fuel-economy panel, warranty and parts-content panels, safety panel and VIN strip on the right. Geometry is transformed from the rotated page; verticals are compressed to clear the banner and disclosure. The owner should confirm that the upright landscape page is acceptable.
- Fonts: Helvetica / Helvetica-Bold stand in for the reference's Arial and DIN-style faces (font_substitution).
- Warranty panel: prints the record's verified warranty terms, else "Not available for this vehicle."; the 10-year graphic and its coverage columns are not reproduced.
- Artwork not reproduced: the "Mitsubishi Motors Confidence" included-items list, "Full Tank of Gas INCLUDED", agency seals, the source Smartphone QR (replaced by the 0.90in Vehicle Passport QR in the same slot at the foot of the fuel-economy panel, on a white backing square), the source barcode (regenerated from the VIN), the cumulative accessory weight line, route code, location and the build string.
- Wording not reproduced: the federal-law label statement under the pricing ("This label has been applied to this vehicle pursuant to federal law ...") is not certified here. The footnote reads "Original manufacturer's suggested retail prices shown. Excludes taxes, title, license, dealer-installed items and current selling price."
- EPA panel: native rebuild with the same indicator semantics (1-10 scores, Not Available for anything else); gradient, bubble shape and spacing are approximated, and the average-vehicle MPG and cost sentence is not printed.
- Safety: the decode gives one frontal and one side value, so combined rows print where the reference shows driver/passenger and front/rear seat; the reference-match fixture carries per-row values to show the full panel. The footer wording uses www.nhtsa.gov/ratings where the reference prints safercar.gov.
- Pricing block: prints MSRP, total additional equipment, subtotal, destination/handling and total MSRP from the record; any value the record lacks prints NOT AVAILABLE. The reference-match values reconcile ($24,995 + $455 + $1,795 = $27,245). The stress record reconciles ($27,995 + $410 + $1,445 = $29,850).
- Fields in the reference with no render-data source: the "4-DOOR SUV" line, the dealer ship-to block (blank unless the original delivering dealer is proven), port of entry (Baltimore), route code, location, accessory weight, build string. Plant/port prints the final assembly point only when the record has one.
- OCR: transcription was spot-checked against the PDF only (ocr_unverified). The reference-match fixture normalizes quotation marks and drops registered and trademark marks.
- Parts content, warranty: not wired by the orchestrator adapter today (blockers parts_content_not_wired, warranty_terms_not_wired); the reference-match render shows the populated state. The stress record shows only the country of final assembly from mc_attributes.made_in.
- Equipment: the reference prints its 26 items under five headings; the stress record prints all 172 at the ladder's compacted size with decoder fragments removed.
- Matching: model Outlander Sport (or RVR), SUV body, gasoline. The full-size Outlander and the Outlander PHEV are not matched and flag template_configuration_unsupported. A record that states no drivetrain still matches.
`;

interface BrandDoc {
  title: string;
  logo: string;
  logoNote?: string;
  rows: string[];
  sample: string[];
  differences: string[];
}

const mappingFor = (b: BrandDoc): string => `# ${b.title} - data source mapping

Every printed value comes from the saved vehicle record the generator already reads (vehicle_listings.mc_attributes from NeoVIN, vehicle_listings.epa_economy from the verified fueleconomy.gov match, dealer_profiles.settings). No provider call is made. Reference-sample values are never used as defaults; they appear only in the reference-match fixture used for side-by-side comparison.

| Printed region | Source field | When missing |
|---|---|---|
| Reproduction banner and disclosure | reproduction.ts | Always printed |
| ${b.logo} | ${b.logoNote ?? "packaged vector-rendered artwork cropped from the reference PDF (logoArtwork.ts)"} | Always printed |
${b.rows.join("\n")}
| Optional equipment / added features (packages, options with price) | build_sheet.packages / options | Nothing listed; a missing price prints N/A, an included item INCLUDED; unpriced paint and trim rows already printed as colours are not repeated |
| MSRP, destination, total | build_sheet.pricing base_msrp, destination_charge, total_msrp (stated, else base + options + destination) | NOT AVAILABLE |
| Standard equipment | build_sheet.standard + key_features through equipmentSelection and catalog hygiene (full list when it fits, else selected lines plus the Passport pointer line) | Unavailable line |
| Warranty | warranty.* (verified OEM terms only) | "Not available for this vehicle." Not wired in the adapter today |
| Fuel economy, annual fuel cost, gallons per 100 miles | epa_economy combined / city / highway / annualFuelCost; gallons from the record or 100 / combined | Unavailable message; nothing is zero |
| You save / You spend over 5 years | epa.fiveYearCostDifference | "5-year fuel cost comparison: Not Available" |
| Greenhouse gas and smog scales | epa_economy.ghgScore, smogScore (integer 1-10) | Not Available; any value outside 1-10 is unavailable |
| CO2 sentence, fuel type tag | epa_economy.co2TailpipeGpm, fuelType | Omitted |
| Government 5-star safety ratings | NHTSA rows in the NeoVIN decode (only when the Standard-NHTSA row is present; IIHS rows never feed stars). One combined frontal and one combined side value print as one row each, never as driver/passenger or seat rows | Not Rated / Not Available / explicit message panel |
| Parts content, final assembly, engine / transmission origin | factory.partsContent (AALA); country of final assembly from the decode made_in value | "Not available for this vehicle." |
| Original delivering dealer (SOLD TO / dealer lines) | dealer block, ONLY when dealerRole is original_delivery | Label printed blank. The current selling rooftop never prints |
| VIN barcode | barcodePayload (= VIN), Code 128 regenerated per vehicle | Always present |
| Passport QR (0.90in including quiet zone) | canonicalPassportUrl(listing.slug); placed in the OEM Smartphone QR slot of the fuel-economy panel${b.title.includes("Durango") ? " (below the parts box for this family)" : ""} | Omitted with its caption when no Passport URL |
`;

const differencesFor = (b: BrandDoc, t: CatalogTemplate): string => `# ${b.title} - differences from the OEM reference

Status: layout ${t.layoutStatus}, approval ${t.approval}. Production routing cannot select this template until the owner approves it.

## Sample data
- reference-match: the reference sticker's own transcribed values, for side-by-side comparison only. It is never used for another vehicle.
${b.sample.join("\n")}

## Blockers (stable codes)
${t.blockers.map((x) => `- ${x}`).join("\n")}

## Unresolved differences
- Page: the reference PDF is 1224x792pt, rotation 0 (upright landscape); the render is the same size and exactly one page.
- Fonts: Helvetica / Helvetica-Bold stand in for the reference faces (font_substitution).
- Layout compression: vertical positions are compressed to clear the mandatory reproduction banner and disclosure.
- Artwork not reproduced: agency seals and the source Smartphone QR (replaced by the 0.90in Vehicle Passport QR). The source barcode is regenerated from the VIN.
- Wording not reproduced: the federal-law label statement ("affixed ... pursuant to federal law") and any Monroney wording; the footnote reads "Original manufacturer's suggested retail prices shown. Excludes taxes, title, license, dealer-installed items and current selling price."
- EPA panel: native rebuild with the same indicator semantics (1-10 scores, Not Available for anything else); gradient, bubble shape and spacing are approximated, and the average-vehicle MPG and cost sentence is not printed.
- Safety: the decode gives one frontal and one side value, so combined rows print where the reference shows driver/passenger and front/rear seat; the reference-match fixture carries per-row values to show the full panel.
- OCR: transcription was spot-checked against the PDF only (ocr_unverified). The reference-match fixture drops trademark and registered marks and normalizes dashes (WinAnsi sanitation).
- Parts content, warranty: not wired by the orchestrator adapter today (blockers parts_content_not_wired, warranty_terms_not_wired); the reference-match render shows the populated state.
- Equipment: decoder fragments (rating rows, speed thresholds, bare counts and letters, engine and drive labels) are dropped before selection; when the full list does not fit at 5.5pt the ranked selection prints with the fixed Passport pointer line.
${b.differences.join("\n")}
`;


interface LetterDoc {
  title: string;
  masterKey: string;
  ownership: string;
  sample: readonly string[];
}

const letterMapping = (b: LetterDoc): string => `# ${b.title} - data source mapping

This catalog entry is served by the owner-approved Letter master (${b.masterKey}, render/variants/letterMonroney.ts). The catalog layout delegates to that builder, so every printed value comes from exactly the same fields, in exactly the same regions, as the production sticker. No provider call is made. The reference sample's values are never used as defaults; they appear only in the reference-match fixture used for side-by-side comparison.

| Printed region | Source field | When missing |
|---|---|---|
| Reproduction banner and disclosure | reproduction.ts | Always printed |
| Brand logo | packaged artwork (logoArtwork.ts, owner-approved master asset) | Always printed |
| Title, VIN, colours, engine, transmission, drivetrain | identity, mechanical, build_sheet.colors, listing.vin | Value omitted |
| Standard equipment sections | build_sheet.standard + key_features through equipmentSelection | Section omitted |
| ${b.ownership} | verified warranty terms (warranty.*) | Omitted |
| Options, packages, MSRP, destination, total | build_sheet.pricing / options / packages | NOT AVAILABLE / N/A |
| Fuel economy and safety ratings | epa_economy (verified fueleconomy.gov match) and NHTSA rows in the NeoVIN decode | Explicit unavailable states |
| Original delivering dealer | dealer block, ONLY when dealerRole is original_delivery | Blank |
| VIN barcode and Passport QR | barcodePayload (= VIN); canonicalPassportUrl(listing.slug) | Always present / omitted with caption when no URL |
`;

const letterDifferences = (b: LetterDoc, t: CatalogTemplate): string => `# ${b.title} - differences from the OEM reference

Status: layout ${t.layoutStatus}, approval ${t.approval}. Production routing for this make is the approved Letter master, not this catalog entry.

## Served by the approved master
- The sample render equals the production master render for the same record (verified by letterMasterCatalog.test.ts); nothing about the approved output changed.
- The make keeps its catalog-only data extras (EPA conflict handling, EV figures) off, because hasBuiltCatalogTemplates excludes entries that carry an existing master.

## Sample data
- reference-match: synthetic vehicle that satisfies the reference variant (test data from render/__fixtures__/letterMasters.ts), for side-by-side comparison only.
${b.sample.join("\n")}

## Blockers (stable codes)
${t.blockers.map((x) => `- ${x}`).join("\n")}

## Unresolved differences
- Page: the reference PDF is a Letter-class landscape page (792x612pt); the render is the same size and exactly one page.
- Type size: the approved master prints some footnote and caption lines at 5.2pt, below the 5.5pt floor the new catalog layouts hold. The approved master was not changed.
- The reference is a marked online copy (marked_online_copy); the approved master reproduces it as the owner approved it.
- Fonts: Helvetica / Helvetica-Bold stand in for the reference faces (font_substitution). OCR was spot-checked only (ocr_unverified).
- Artwork not reproduced: agency seals and the source QR (replaced by the Vehicle Passport QR); the barcode is regenerated from the VIN.
`;

const BRAND_DOCS: Record<string, BrandDoc> = {
  aston: {
    title: "Aston Martin 2026 Vantage Roadster (gasoline)",
    logo: "Aston Martin wings emblem",
    logoNote: "packaged artwork cropped from the reference scan (logoArtwork.ts) as an alpha-masked raster at 300 dpi; the PDF has no vector or text layer",
    rows: [
      "| Black header band: dealer, model, model year, exterior and interior colour, VIN, model name | the original delivering dealer only (blank otherwise); identity (model, trim, year); build_sheet.colors; listing.vin | Value omitted, label kept |",
      "| Owner benefits and standard features | verified warranty terms only; normalized standard equipment grouped by category | \"Warranty terms are not available for this vehicle.\"; \"Standard equipment not available for this vehicle.\" |",
      "| Suggested retail price and optional equipment | build_sheet.pricing.base_msrp; build_sheet.packages / options | NOT AVAILABLE; nothing listed, a missing price prints N/A |",
      "| Transportation and handling, gas guzzler, total suggested retail | build_sheet.pricing destination_charge, gas guzzler tax (only when the record states it), total | NOT AVAILABLE / row omitted |",
    ],
    sample: ["- sticker-JTEMU5JR2N5993023: off-year, other-make layout stress test (2022 Toyota 4Runner SR5, used), not a production candidate. Production has no Aston Martin record and none has ever been saved, so a saved record of another make is used through the sample path.", "- the reference's printed total (221,525.00) exceeds the sum of its printed lines (205,900.00 base + 4,925.00 options + 3,500.00 transportation and handling = 214,325.00) by 7,200.00, the reference's Import Costs line, which has no field in the render data and is not printed. The reference-match fixture keeps the printed total, so it does not reconcile by 7,200.00."],
    differences: [
      "- Page: the reference PDF is stored rotated (Page rot 270, 792x1224) and has no text layer; the render is the upright 1224x792 landscape page and exactly one page. Reference values were read from the raster scan (no_text_layer_in_reference).",
      "- Layout: Aston Martin's own family (black header band, three-zone body). The free area under the fuel-economy panel, which holds a faded car photograph in the scan, carries a third equipment column so a full standard list fits.",
      "- Vantage Roadster versus coupe: the match rule is 2026 Vantage, convertible body (roadster, cabriolet, spyder or drophead text), gasoline. A coupe body, other model or year, or any other powertrain is not matched and flags template_configuration_unsupported.",
      "- Artwork and text not reproduced: the faded car photograph, the engine-number line (the engine, transmission and drivetrain fields have no region on this reference apart from the equipment list), the port-of-entry line, the import-costs line, the bumper-quality paragraph and notice, the Best Sports Car advertisement and window tag, the social icons, agency seals and the source QR.",
    ],
  },
  lincoln: {
    title: "Lincoln 2026 Nautilus Premiere (gasoline)",
    logo: "Lincoln star",
    logoNote: "packaged artwork cropped from the reference PDF (logoArtwork.ts) as an alpha-masked raster rendered at 900 dpi",
    rows: [
      "| Header: make and model, year drivetrain trim line, engine, transmission, exterior and interior colour | identity; mc_attributes.engine / transmission; build_sheet.colors | Row omitted |",
      "| Standard equipment included at no extra charge (with the warranty block as the last section) | normalized standard equipment, grouped by category; verified warranty terms only | \"Standard equipment not available for this vehicle.\"; warranty \"Not available for this vehicle.\" |",
      "| Included on this vehicle / optional equipment and other, with MSRP | build_sheet.packages / options (a no-charge item prints INCLUDED) | Nothing listed; a missing price prints N/A |",
      "| Price information: base price, total options, total vehicle and options, destination and delivery, total MSRP | build_sheet.pricing (stated, else base + options + destination) | NOT AVAILABLE |",
      "| Sold to, final assembly plant, method of transportation, VIN, barcode | the original delivering dealer only; factory fields; listing.vin | Label printed blank / row omitted |",
    ],
    sample: ["- sticker-3LNHM28T48R625400: off-year, other-model layout stress test (2008 Lincoln MKZ Base, used; the only saved Lincoln record), not a production candidate. Production has no Nautilus record. The standard-equipment list is trimmed to about 100 items."],
    differences: [
      "- Layout family: the reference follows the Ford label family (the F-250 module's structure of equipment panel, options and price block, total strip) but carries the EPA and NHTSA panels at the right where the F-250 carries the CARB panel, so the layout is its own, built on the shared EPA and safety panels; it does not reuse fordF250Diesel.ts directly.",
      "- No parts-content box: the reference prints none, so none is drawn and parts-content data is not shown.",
      "- Artwork not reproduced: the Lincoln app, Lincoln Protect and Lincoln Automotive Financial Services advertisements, the ramp, rail, order and production codes, the 5-passenger and order-number lines, the residency-restrictions box, the federal-law label statement and the source QR codes. The reference prints amounts without a dollar sign and 'NO CHARGE'; the render prints dollar amounts and INCLUDED.",
      "- Matching: 2026 Nautilus, SUV, gasoline. The Nautilus hybrid (a hybrid powertrain record) and any other powertrain, model or year are not matched and flag template_configuration_unsupported.",
    ],
  },
  maserati: {
    title: "Maserati 2026 GranTurismo Trofeo (gasoline)",
    logo: "Maserati trident and wordmark",
    logoNote: "packaged artwork extracted from the reference PDF (logoArtwork.ts): the PDF holds the whole label as a raster scan, so the logo is packaged as an alpha-masked raster crop, not vector paths",
    rows: [
      "| Header: model, exterior and interior colour, MSRP line | identity (model); build_sheet.colors; build_sheet.pricing.base_msrp | Row omitted / NOT AVAILABLE |",
      "| Title box (year model trim) and specification line (engine, transmission, drivetrain) | identity; mc_attributes.engine / transmission / drivetrain | Omitted, never guessed |",
      "| Exclusive standard equipment | normalized standard equipment, grouped by category, in two columns | \"Standard equipment not available for this vehicle.\" |",
      "| Additional options | build_sheet.packages / options with price | Nothing listed; a missing price prints N/A |",
      "| Suggested price box: destination charge, gas guzzler tax, total | build_sheet.pricing (gas guzzler tax only when the record states it) | NOT AVAILABLE / row omitted |",
      "| V.I.N., importation, ship to | listing.vin; transportMethod; the original delivering dealer only | Label printed blank / omitted |",
    ],
    sample: ["- sticker-JTJTBCDX8R5032546: off-year, other-make layout stress test (2024 Lexus GX Premium+, used), not a production candidate. Production has no Maserati record and no Maserati has ever been saved, so a saved record of another make is used through the sample path. The standard-equipment list is trimmed to about 80 items.", "- the reference's printed total (179,345.00) exceeds the sum of its printed lines (166,000.00 base + 10,850.00 options + 2,195.00 destination = 179,045.00) by 300.00, the reference's Preparation and Delivery charge, which has no field in the render data and is not printed. The reference-match fixture keeps the printed total, so it does not reconcile by 300.00."],
    differences: [
      "- Layout: a Maserati-specific family (white equipment half, light-blue regulatory half). The FCA family module does not fit although Stellantis owns the brand, so the layout is bespoke, built from the shared EPA, safety and parts panels.",
      "- Gran Turismo Trofeo gas versus Folgore: the match rule is 2026 GranTurismo, coupe, gasoline. The Folgore is electric, so an electric record (and a plug-in or hybrid one) is not matched and flags template_configuration_unsupported; the Folgore would need its own reference label.",
      "- Artwork not reproduced: the \"GranTurismo\" script wordmark (the model prints as text), the model description paragraph (marketing copy, not data), the importer address, the preparation-and-delivery line, agency seals, the source QR and the Maserati.com footer advertising style. The reference scan also carries a navy left edge and notch, drawn here as plain shapes.",
    ],
  },
  alfa: {
    title: "Alfa Romeo 2026 Giulia Veloce (gasoline)",
    logo: "Alfa Romeo badge",
    logoNote: "packaged artwork extracted from the reference PDF (logoArtwork.ts): the reference holds the badge as a 330x330 grayscale raster, so it is packaged as an alpha-masked raster, not vector paths",
    rows: [
      "| Header: model, trim, drivetrain title, model-year line, Alfa Romeo contact line | identity (year, model, trim); drivetrain from sourceCorrections.decideDrivetrain; fixed OEM contact text | Missing parts omitted, never guessed |",
      "| Specification block: make and model, exterior and interior colour, engine, transmission | identity; build_sheet.colors; mc_attributes.engine / transmission | Row omitted |",
      "| Warranty coverage | verified warranty terms only | \"Not available for this vehicle.\" |",
      "| Assembly point / port of entry, SOLD TO | factory.finalAssemblyPoint; the original delivering dealer only | Omitted / label printed blank |",
    ],
    sample: ["- sticker-ZASPAKBN5L7C99407: off-year, other-model layout stress test (2020 Stelvio Ti Sport Carbon, used; the only saved Alfa Romeo record), not a production candidate. Production has no Giulia record. The standard-equipment list is trimmed to about 100 items and the record has no EPA match, so the EPA panel prints its unavailable states."],
    differences: [
      "- Layout family: the reference follows the FCA label family exactly (red frame, specification block, equipment columns, EPA, safety and parts panels), so the layout reuses fcaCommon.ts with an Alfa Romeo header.",
      "- Giulia Veloce and Quadrifoglio: decided to share this one layout. The Quadrifoglio label differs only in content (trim, engine, option set and a possible gas guzzler tax row, which the FCA family already prints from data), so the match rule is year 2026, model Giulia, sedan, gasoline for every trim. Only the Veloce reference was available; the Quadrifoglio rendering is unreviewed against its own OEM label.",
      "- Artwork not reproduced: the manufacturer line (FCA US LLC), the SL, ship-to and L4-VON codes, the production strip and the bumper-performance paragraph. The reference's Interior line (seat description) has no data field and is not printed.",
      "- Matching: 2026 Giulia, sedan, gasoline. Any hybrid or other powertrain, any other model (for example the Stelvio) and any other year is not matched and flags template_configuration_unsupported.",
    ],
  },
  honda: {
    title: "Honda 2026 Odyssey Touring (gasoline)",
    logo: "Honda wordmark (the logo in the reference scan is damaged)",
    rows: [
      "| Honda title block: year, model, trim, EXT and INT colors | identity (year, model, trim); build_sheet.colors | Omitted |",
      "| Standard equipment at no extra cost | normalized standard equipment, grouped by category | \"Standard equipment not available for this vehicle.\" |",
      "| Manufacturer's Suggested Retail Price, installed options, Destination and Handling, Total Vehicle Price | build_sheet.pricing, packages, options | NOT AVAILABLE |",
      "| Delivered to, trans. method, emission, dealer code, VIN, barcode | transportMethod, factory codes and the original delivering dealer only; listing.vin | Label printed blank |",
      "| Warranty (roadside term) | verified warranty terms only | \"Warranty not available for this vehicle.\" |",
    ],
    sample: ["- sticker-5FNRL6H6XSB089137: off-year layout stress test (2025 Odyssey EX-L, used), not a production candidate. Production has no 2026 Odyssey record."],
    differences: [
      "- Page: the reference PDF is a 612x792pt portrait page (rotation 0, no text layer) that stores a landscape label sideways (reference_stored_rotated); the render is upright at 792x612pt. The reference scan is a torn, marked copy; the owner should confirm the upright letter-landscape page is acceptable.",
      "- Artwork not reproduced: the Honda logo (damaged in the scan, so the wordmark prints; missing_source_artwork), the Smartphone QR (the 0.90in Vehicle Passport QR takes its slot), agency seals, the MOB code, the engine number, the full-tank-of-fuel line, the control and reference numbers and the second barcode.",
      "- The fuel-economy panel is the shared panel drawn at 82% (epa_panel_scaled) so the letter page keeps every line at or above 5.5pt.",
      "- Matching: 2026 Odyssey, minivan, gasoline. The Odyssey has no hybrid configuration; any plug-in or hybrid powertrain is not matched and flags template_configuration_unsupported.",
    ],
  },
  volvo: {
    title: "Volvo 2025 XC60 B5 (mild hybrid gasoline)",
    logo: "Volvo identity line (the reference prints no logo artwork)",
    rows: [
      "| 2025 VOLVO line, model and trim title | identity (year make, model trim) printed as text | Omitted |",
      "| Authorized Retailer, Delivery address | original delivering dealer only | Headings print with no dealer text |",
      "| Pricing block: MSRP, packages and options, destination, total | build_sheet.pricing, packages, options | NOT AVAILABLE |",
      "| Vehicle identification, delivery | identity; build_sheet.colors; listing.vin; transportMethod | Row omitted |",
      "| Accessories, Join the Conversation | fixed OEM boilerplate (no vehicle value) | Always printed |",
      "| Maintenance | no record field | \"Not available for this vehicle.\" |",
    ],
    sample: ["- sticker-YV4L12RK0N1034397: off-year layout stress test (2022 XC60 Momentum, B5 mild hybrid, used), not a production candidate. Production has no 2025 XC60."],
    differences: [
      "- The reference is a 2025 example (reference_is_2025): the template matches 2025 only, so a 2026 XC60 is flagged unsupported.",
      "- Artwork not reproduced: the category icons, the accessories QR (the Vehicle Passport QR sits in the fuel-economy panel's QR slot), agency seals and the source barcode (regenerated from the VIN). The reference prints no Volvo logo; its model logotype prints as plain text.",
      "- The Maintenance programme (3 years / 30,000 miles) and the model-year-specific accessory text are not on any record; the maintenance section prints its unavailable state. The Plus Features list is part of the standard equipment.",
      "- The reference's EPA panel has no 1-10 tracks (the Figma handoff reconstructed them); the shared panel draws the tracks and pointers from the scores.",
      "- Free columns of the reference (under Accessories and under Pricing) carry overflow standard equipment.",
      "- Matching: 2025 XC60, SUV, gasoline (the B5 mild hybrid reports as gasoline). The XC60 Recharge and any T8, T6 or B6 trim, and any plug-in powertrain, are not matched and flag template_configuration_unsupported; the B6 rule is unverified (powertrain_rule_unverified).",
    ],
  },
  lexus: {
    title: "Lexus 2026 RX 350 (gasoline)",
    logo: "Lexus logo and tagline",
    rows: [
      "| DESCRIPTION, COLOR, VIN, FINAL ASSEMBLY POINT | identity (year model trim); build_sheet.colors; listing.vin; factory.finalAssemblyPoint | Row omitted |",
      "| Delivered by Truck to | transportMethod and the original delivering dealer only | Label printed blank |",
      "| Installed options, base price, MSRP, delivery, total | build_sheet.pricing, packages, options | NOT AVAILABLE |",
    ],
    sample: ["- sticker-JTJTBCDX8R5032546: off-year, other-model layout stress test (2024 Lexus GX Premium+, used), not a production candidate. Production has no RX record."],
    differences: [
      "- The reference PDF is stored rotated (Page rot 90, 792x1224pt); the render is upright at 1224x792pt (reference_stored_rotated). The reference is a marked online copy (marked_online_copy): its 'Not Original - Copy' watermark and creation stamp are not reproduced.",
      "- Logo: the Lexus logo and tagline are a raster image inside the reference PDF; its alpha-masked pixels are packaged as-is (logoArtwork.ts). No vector source exists in the PDF.",
      "- Not printed: the 9412J model code, the dealer-owner support offer panel, the empty frame beside the delivery box, the production strip (742 / L046) and the source barcode (regenerated from the VIN). The parts-content box takes the offer panel's slot.",
      "- The reference prints its equipment under five OEM headings; the engine regroups equipment under its own category headings.",
      "- Matching: 2026 RX 350 (or the bare RX model), SUV, gasoline. The RX 350h, RX 450h+ and RX 500h (by model, trim or powertrain) are not matched and flag template_configuration_unsupported. A record that states no drivetrain still matches.",
    ],
  },
  toyota4runner: {
    title: "Toyota 2026 4Runner (gasoline)",
    logo: "Toyota logo",
    rows: [
      "| DESC., VIN, YR/MDL, CLR, FINAL ASSEMBLY POINT | identity; listing.vin; build_sheet.colors; factory.finalAssemblyPoint | Row omitted |",
      "| Delivered by Truck to | transportMethod, factoryCodes.dealer and the original delivering dealer only | Label printed blank |",
      "| Base price, optional equipment, MSRP, delivery, total | build_sheet.pricing, packages, options | NOT AVAILABLE |",
    ],
    sample: ["- sticker-JTEMU5JR2N5993023: off-year layout stress test (2022 4Runner SR5, used), not a production candidate. Production has no 2026 4Runner."],
    differences: [
      "- The reference PDF is stored rotated (Page rot 90, 792x1224pt); the render is upright at 1224x792pt (reference_stored_rotated). The reference is a marked online copy (marked_online_copy): its watermark and creation stamp are not reproduced.",
      "- Logo: the Toyota emblem and wordmark are a raster image inside the reference PDF; its alpha-masked pixels are packaged as-is (logoArtwork.ts). No vector source exists in the PDF.",
      "- Not printed: the 8664S model code, the full-tank statement, the delivery dealer's customer number position, the production strip and the source barcode (regenerated from the VIN). The reference leaves its right quarter blank; the parts-content box and any overflow equipment columns use it.",
      "- The reference's no-price rows (50 State Emissions, Owner's Portfolio) print INCLUDED in the reference-match render.",
      "- Matching: 2026 4Runner, SUV, gasoline. The i-FORCE MAX hybrid is not matched when the model, trim (TRD Pro, Trailhunter, Platinum are hybrid-only) or the decode's HEV powertrain says so; a hybrid whose record gives none of these signals cannot be told apart (powertrain_rule_unverified).",
    ],
  },
  sorento: {
    title: "Kia 2026 Sorento (gasoline)",
    logo: "Kia logo",
    rows: [
      "| Title (year model trim drivetrain) | identity from ymm + listing.trim; drivetrain from sourceCorrections.decideDrivetrain | Missing parts omitted, never guessed |",
      "| Exterior / interior colour, VEHICLE ID NUMBER, assembly point | build_sheet.colors; listing.vin; factory.finalAssemblyPoint | Row omitted |",
      "| Sold To / Ship To | original delivering dealer only (dealerCode + dealer lines) | Labels print blank |",
    ],
    sample: ["- sticker-5XYRLDJC9RG278742: off-year layout stress test (2024 Sorento S, used), not a production candidate. Production has no 2026 Sorento."],
    differences: [
      "- Model/opt code, ship-to code, total additional weight, Kia Connect and privacy footnotes: no render-data source or not certified; not printed. The port-of-entry row prints the final assembly point as ASSEMBLY POINT.",
      "- Optional equipment: the reference prints paint and floor mats as additional installed equipment; options print as listed on the record.",
      "- Matching: 2026 Sorento, SUV, gasoline. Sorento Hybrid and Plug-In Hybrid (by model name or powertrain) are not matched and flag template_configuration_unsupported.",
    ],
  },
  forester: {
    title: "Subaru 2026 Forester (gasoline)",
    logo: "Subaru logo",
    rows: [
      "| Model wordmark | identity.model printed as text (the reference prints a model logotype) | Omitted |",
      "| VIN, Vehicle, Port/Assembly, Deliver by/Carrier | listing.vin; identity; factory.finalAssemblyPoint; transportMethod | Row omitted |",
      "| Exterior colour, optional equipment, destination and total | build_sheet.colors, packages, options, pricing | Row omitted / NOT AVAILABLE |",
      "| SOLD TO | original delivering dealer only | Label printed blank |",
    ],
    sample: ["- sticker-JF2SKAJC9MH531918: off-year layout stress test (2021 Forester Premium, used), not a production candidate. Production has no 2026 Forester."],
    differences: [
      "- Artwork not reproduced: the Consumer Reports Recommended panel, the Subaru Added Security panel, the privacy-notice strip and its QR. The promotional panel's slot carries the parts-content box; the fuel-economy panel sits below the safety panel as in the reference.",
      "- Model code (TFH), Full Tank of Gas INCLD row and the privacy notice: not printed.",
      "- The bottom-left strip holds the SOLD TO block, the footnote and the regenerated barcode.",
      "- Matching: 2026 Forester, SUV, gasoline. The Forester Hybrid (by model, trim or powertrain) is not matched and flags template_configuration_unsupported.",
    ],
  },
  gv80: {
    title: "Genesis 2026 GV80 (gasoline)",
    logo: "Genesis logo",
    rows: [
      "| Title and VIN lines | identity (year model trim drivetrain); listing.vin printed top left and top right | Missing parts omitted |",
      "| Header program panel | warranty.* (verified terms only) in the slot the reference uses for The Genesis Experience | \"Not available for this vehicle.\" |",
      "| VIN, exterior, interior/seat colour, transport, assembly point, emissions cells | listing.vin; build_sheet.colors; transportMethod; finalAssemblyPoint; emissionsCode | Cell prints \"Not available\" |",
      "| SOLD TO / SHIPPED TO | original delivering dealer only | Labels print blank |",
    ],
    sample: ["- sticker-KMTG34SC6RU142669: off-year, other-model layout stress test (2024 G70 sedan, used), not a production candidate. Production has no GV80 and no 2026 Genesis record."],
    differences: [
      "- The Genesis Experience program claims (complimentary maintenance, valet, map care, connected services) are not reproduced: they are not verified terms. The panel prints the record's verified warranty instead.",
      "- Model code, accessory weight, the production strip and the third VIN line: not printed. The reference's two empty frames beside the safety panel are replaced by the footnote text.",
      "- Matching: 2026 GV80, SUV, gasoline. GV80 Coupe and any non-gasoline powertrain are not matched and flag template_configuration_unsupported.",
    ],
  },
  durango: {
    title: "Dodge 2026 Durango (gasoline)",
    logo: "Dodge logo",
    rows: [
      "| Model-year digits, title | identity.year (stacked) and model trim drivetrain | Omitted, never guessed |",
      "| Spec line, Exterior / Interior colour, Engine, Transmission | identity; build_sheet.colors; mc_attributes.engine / transmission | Row omitted |",
      "| Base Price box, destination, total | build_sheet.pricing | NOT AVAILABLE |",
      "| Assembly Point/Port of Entry, SOLD TO | factory.finalAssemblyPoint; original delivering dealer only | Omitted / blank |",
    ],
    sample: ["- sticker-2D8HN54P68R833362: off-year, other-model layout stress test (2008 Grand Caravan SXT, used, no saved EPA match), not a production candidate. Production has no Durango record."],
    differences: [
      "- Shared FCA layout family (fcaCommon.ts, also used by the Wrangler and Voyager); only the logo, black frame, title and contact line are Durango-specific.",
      "- Artwork not reproduced: the FlexCare vehicle protection advertisement and the 5-year/60,000-mile powertrain warranty graphic; the italic title face is bold upright. The \"FCA US LLC\" line and the L4-VON / S.L. / SHIP TO fields are not printed.",
      "- Matching: 2026 Durango, SUV, gasoline. SRT Hellcat is gasoline and matches. Any plug-in or hybrid powertrain is not matched.",
    ],
  },
  envista: {
    title: "Buick 2026 Envista (gasoline)",
    logo: "Buick logo",
    rows: [
      "| Title, EXTERIOR, INTERIOR, ENGINE, TRANSMISSION | identity; build_sheet.colors; mc_attributes.engine / transmission | Row omitted |",
      "| Standard vehicle price, options and pricing, totals | build_sheet.pricing, options; total options from the record | NOT AVAILABLE |",
      "| VIN, dealer to whom delivered, assembly point | listing.vin; original delivering dealer only; factory.finalAssemblyPoint | Label printed blank / omitted |",
    ],
    sample: ["- sticker-KL47LCEP0TB000001: SYNTHETIC stress fixture (invented values). No Buick row exists in the saved vehicle_listings, so no real record was available; it is not a real vehicle."],
    differences: [
      "- Artwork not reproduced: the adhesive-strip notice, the OnStar advertisement and its QR, the order-information QR, the driving-range bars and the flex-fuel E85 tag (the fuel tag prints the verified EPA fuel type); sales codes and order numbers have no render-data source.",
      "- Equipment flow: the standard equipment now fills all five of the OEM's columns on the reference's 17px line pitch in upper case with bullets (previously the two rightmost columns stayed empty).",
      "- Standard equipment prints in the reference's column arrangement; the reference's pricing box occupies two columns, this layout gives pricing the right-hand column.",
      "- Matching: 2026 Envista, SUV, gasoline. A non-SUV body or non-gasoline powertrain is not matched.",
    ],
  },
};

interface HdDoc {
  title: string;
  logo: string;
  rows: string[];
  sample: string[];
  differences: string[];
}

const hdMappingFor = (b: HdDoc): string => `# ${b.title} - data source mapping

Every printed value comes from the saved vehicle record the generator already reads (vehicle_listings.mc_attributes from NeoVIN, dealer_profiles.settings). No provider call is made. Reference-sample values appear only in the reference-match fixture used for side-by-side comparison; a test renders an empty record to prove none leaks.

| Printed region | Source field | When missing |
|---|---|---|
| Reproduction banner and disclosure | reproduction.ts | Always printed |
| ${b.logo} | packaged artwork cropped from the reference PDF (logoArtwork.ts) | Always printed |
${b.rows.join("\n")}
| Optional equipment / added features (packages, options with price) | build_sheet.packages / options | Nothing listed; a missing price prints N/A, an included item INCLUDED |
| MSRP, destination, total | build_sheet.pricing base_msrp, destination_charge, total_msrp (stated, else base + options + destination) | NOT AVAILABLE |
| Standard equipment | build_sheet.standard + key_features through equipmentSelection and catalog hygiene | Unavailable line |
| Warranty | warranty.* (verified OEM terms only) | "Not available for this vehicle." Not wired in the adapter today |
| California Air Resources Board panel | Fixed OEM headings. The data model carries no CARB grades, so both scales print "Not Available". The green fuel tag prints only when the record states a fuel type (verified EPA match, else the NeoVIN fuel_type when it states diesel, else engine text naming diesel) | Tag omitted |
| EPA fuel-economy panel | Not drawn: the reference has none (over 8,500 lb GVWR). Nothing is read from the EPA match | n/a |
| Government safety ratings | NHTSA rows in the NeoVIN decode (combined frontal and side values, never split into driver/passenger or seat rows) | Heavy-duty pickups are usually not rated: the panel says so, or that no verified record exists |
| Original delivering dealer (SOLD TO / dealer lines) | dealer block, ONLY when dealerRole is original_delivery | Label printed blank. The current selling rooftop never prints |
| VIN barcode | barcodePayload (= VIN), Code 128 regenerated per vehicle | Always present |
| Passport QR (0.90in including quiet zone) | canonicalPassportUrl(listing.slug); placed in the slot the reference uses for its advertisement | Omitted with its caption when no Passport URL |
`;

const hdDifferencesFor = (b: HdDoc, t: CatalogTemplate): string => `# ${b.title} - differences from the OEM reference

Status: layout ${t.layoutStatus}, approval ${t.approval}. Production routing cannot select this template until the owner approves it.

## Sample data
- reference-match: the reference sticker's own transcribed values, for side-by-side comparison only. It is never used for another vehicle.
${b.sample.join("\n")}

## Blockers (stable codes)
${t.blockers.map((x) => `- ${x}`).join("\n")}

## Unresolved differences
- Page: the reference PDF is 1224x792pt (17x11in landscape); the render is the same size and exactly one page.
- Fonts: Helvetica / Helvetica-Bold stand in for the reference faces (font_substitution).
- Layout compression: vertical positions are compressed to clear the mandatory reproduction banner and disclosure.
- Powertrain rule: this template matches diesel pickups only. Fuel evidence is the verified EPA fuel type, else the NeoVIN fuel_type when it states diesel. Gasoline heavy-duty pickups are not matched and flag template_configuration_unsupported; no gasoline reference was supplied.
- CARB panel: native rebuild of the reference's California Air Resources Board panel. The record has no CARB grades, so both scales print "Not Available" with no pointer (carb_panel_pending). The CARB emblem is not reproduced; its name prints as a plain wordmark.
- No EPA fuel-economy panel is drawn because the reference has none.
- Artwork not reproduced: agency seals, the source QR codes (replaced by the 0.90in Vehicle Passport QR) and the source barcode (regenerated from the VIN). The federal-law label statement and any Monroney wording are not reproduced; the footnote reads "Original manufacturer's suggested retail prices shown. Excludes taxes, title, license, dealer-installed items and current selling price."
- Safety: the decode gives one frontal and one side value, so combined rows print where a rated vehicle would show them; heavy-duty pickups are usually not rated and the panel states that.
- OCR: transcription was spot-checked against the PDF only (ocr_unverified). The reference-match fixture drops trademark and registered marks and normalizes dashes (WinAnsi sanitation).
- Parts content, warranty: not wired by the orchestrator adapter today; the reference-match render shows the populated state.
- Equipment: decoder fragments are dropped before selection; when the full list does not fit at 5.5pt the ranked selection prints with the fixed Passport pointer line.
${b.differences.join("\n")}
`;

const HD_DOCS: Record<string, HdDoc> = {
  f250: {
    title: "Ford 2026 F-250 Super Duty (diesel)",
    logo: "Ford logo",
    rows: [
      "| Vehicle description (model, year, trim, drivetrain, engine, transmission) | identity; mc_attributes.engine / transmission | Row omitted |",
      "| Exterior / interior colour | build_sheet.colors | Row omitted |",
      "| Final assembly plant, method of transport | factory.finalAssemblyPoint; transportMethod | Row omitted |",
    ],
    sample: ["- sticker-1FTFW3L84RKF67857: off-year, other-model layout stress test (2024 F-150 XLT, used), not a production candidate. Production has no 2026 F-250 record. The saved EPA match on this row is an F-150 Lightning record; the shared EPA matcher flags it as contradicting the combustion listing, so the EPA panel prints Not Available and no fuel-type tag (flag epa_match_conflict)."],
    differences: [
      "- The reference has a blue frame, no safety panel and a Prop 65 notice; all are reproduced. The Prop 65 text is a fixed OEM boilerplate heading.",
      "- Matching: 2026 F-250 (Super Duty), pickup body, diesel. F-150, F-350 and gasoline F-250 are not matched.",
    ],
  },
  ram: {
    title: "Ram 2026 2500 Limited (diesel)",
    logo: "Ram logo",
    rows: [
      "| Model year, title | identity.year and model trim drivetrain | Omitted, never guessed |",
      "| Spec line, Exterior / Interior colour, Engine, Transmission | identity; build_sheet.colors; mc_attributes | Row omitted |",
      "| Assembly Point/Port of Entry, SOLD TO | factory.finalAssemblyPoint; original delivering dealer only | Omitted / blank |",
    ],
    sample: ["- sticker-3C6UR5CJXNG247030: off-year layout stress test (2022 RAM 2500 Tradesman, 6.4L gasoline, used), not a production candidate. Production has no 2026 Ram 2500."],
    differences: [
      "- Shared FCA layout family (fcaCommon.ts); the right-hand panels are the CARB panel, the safety panel and the Passport QR in place of the FlexCare advertisement.",
      "- Matching: 2026 Ram 2500 pickup, diesel. Ram 1500, 3500 and gasoline 2500 are not matched.",
    ],
  },
  silverado: {
    title: "Chevrolet 2026 Silverado 2500 HD High Country (diesel)",
    logo: "Chevrolet logo",
    rows: [
      "| Title, EXTERIOR, INTERIOR, ENG, TRANS | identity; build_sheet.colors; mc_attributes.engine / transmission | Row omitted |",
      "| Options and pricing, totals | build_sheet.pricing, options | NOT AVAILABLE |",
      "| VIN, dealer to whom delivered, assembly point | listing.vin; original delivering dealer only; factory.finalAssemblyPoint | Label printed blank / omitted |",
    ],
    sample: ["- sticker-1GNSKPKD9PR173461: off-year, other-model layout stress test (2023 Tahoe Z71, used), not a production candidate. Production has no 2026 Silverado HD."],
    differences: [
      "- Shared General Motors layout family (gmCommon.ts, gmTruckCommon.ts, also used by the Sierra and the Buick Envista). The reference's empty safety and parts frames print an explicit unavailable state when the data is missing.",
      "- Artwork not reproduced: the OnStar advertisement and its QR, the order-information QR, the adhesive-strip notice, sales codes and order numbers.",
      "- Matching: 2026 Silverado 2500 HD pickup, diesel. Silverado 1500, 3500 and gasoline 2500 are not matched.",
    ],
  },
  sierra: {
    title: "GMC 2026 Sierra 3500 HD Denali Ultimate (diesel)",
    logo: "GMC logo",
    rows: [
      "| Title, EXTERIOR, INTERIOR, ENG, TRANS | identity; build_sheet.colors; mc_attributes.engine / transmission | Row omitted |",
      "| Options and pricing, totals | build_sheet.pricing, options | NOT AVAILABLE |",
      "| VIN, dealer to whom delivered, assembly point | listing.vin; original delivering dealer only; factory.finalAssemblyPoint | Label printed blank / omitted |",
    ],
    sample: ["- sticker-1GKS2DKL7MR290552: off-year, other-model layout stress test (2021 Yukon Denali, used), not a production candidate. Production has no 2026 Sierra HD."],
    differences: [
      "- Shared General Motors layout family with the Silverado template; the logo, site line and title are GMC-specific.",
      "- Artwork not reproduced: the OnStar advertisement and its QR, the order-information QR, the adhesive-strip notice, sales codes and order numbers.",
      "- Matching: 2026 Sierra 3500 HD pickup, diesel. Sierra 1500, 2500 and gasoline 3500 are not matched.",
    ],
  },
};


interface EvDoc {
  title: string;
  mode: "electric" | "plug-in hybrid";
  logo: string;
  page: string;
  sample: string;
  extra: string[];
}

const evMappingFor = (b: EvDoc): string => `# ${b.title} - data source mapping

Every printed value comes from the saved vehicle record the generator already reads (vehicle_listings.mc_attributes from NeoVIN, epa_economy, dealer_profiles.settings). No provider call is made. Reference-sample values appear only in the reference-match fixture used for side-by-side comparison; a test renders an empty record to prove none leaks.

| Printed region | Source field | When missing |
|---|---|---|
| Reproduction banner and disclosure | reproduction.ts | Always printed |
| ${b.logo} | not packaged; a neutral wordmark prints (missing_source_artwork) | Always printed |
| Title, colours, VIN, engine, transmission | identity; build_sheet.colors; listing.vin; mc_attributes | Row omitted |
| Options and packages with price | build_sheet.packages / options | Nothing listed; a missing price prints N/A, an included item INCLUDED |
| MSRP, destination, total | build_sheet.pricing (stated, else base + options + destination) | NOT AVAILABLE |
| Standard equipment | build_sheet.standard + key_features through equipmentSelection and catalog hygiene | Unavailable line |
| Warranty | warranty.* (verified OEM terms only) | "Not available for this vehicle." Not wired in the adapter today |
| ${b.mode} fuel-economy panel: MPGe, city, highway, annual cost, 5-year difference, GHG and smog scores, CO2 | epa_economy of the verified EPA match (matcher epa-match-v2; a contradicted match is treated as unverified) | Not Available, never zero |
| kWh per 100 miles, charge time, electric and total range${b.mode === "plug-in hybrid" ? ", gasoline-only MPG" : ""} | optional epa_economy fields combinedMpge, kwhPer100Miles, chargeTimeHours, electricRangeMiles, totalRangeMiles, gasCombinedMpg; none are saved on current records (ev_figures_not_wired) | Not Available; the range chart prints its unavailable state and no bar |
| Government safety ratings | NHTSA rows in the NeoVIN decode (combined frontal and side values, never split) | Panel states not rated / no verified record |
| Parts content | factory.partsContent (verified rows only) | "Not available for this vehicle." Not wired today |
| Original delivering dealer (SOLD TO) | dealer block, ONLY when dealerRole is original_delivery | Label printed blank |
| VIN barcode | barcodePayload (= VIN), Code 128 regenerated per vehicle | Always present |
| Passport QR (0.90in including quiet zone) | canonicalPassportUrl(listing.slug) | Omitted with its caption when no Passport URL |
`;

const evDifferencesFor = (b: EvDoc, t: CatalogTemplate): string => `# ${b.title} - differences from the OEM reference

Status: layout ${t.layoutStatus}, approval ${t.approval}. Production routing cannot select this template until the owner approves it.

## Sample data
- reference-match: the reference sticker's own transcribed values, for side-by-side comparison only. It is never used for another vehicle.
${b.sample}

## Blockers (stable codes)
${t.blockers.map((x) => `- ${x}`).join("\n")}

## Unresolved differences
- Page: ${b.page}
- Fonts: Helvetica / Helvetica-Bold stand in for the reference faces (font_substitution).
- Layout compression: vertical positions are compressed to clear the mandatory reproduction banner and disclosure.
- Matching: model year, model, body and powertrain. This template matches ${b.mode === "electric" ? "electric (fuel class electric)" : "plug-in hybrid (fuel class phev)"} records only; gasoline and the other electrified classes are not matched and flag template_configuration_unsupported.
- Range graphics are drawn only from record data (an electric vehicle's saved range is its total range; a plug-in hybrid's is its electric range). The reference's printed axis breaks are not reproduced as a continuous scale, and no bar is drawn without a range figure.
- Artwork not reproduced: logo, agency seals, the source QR (replaced by the 0.90in Vehicle Passport QR) and the source barcode (regenerated from the VIN). The federal-law label statement and any Monroney wording are not reproduced; the footnote reads "Original manufacturer's suggested retail prices shown. Excludes taxes, title, license, dealer-installed items and current selling price."
- Safety: the decode gives one frontal and one side value, so combined rows print where the reference shows per-seat rows.
- OCR: transcription was spot-checked against the PDF only (ocr_unverified).
- Equipment: decoder fragments are dropped before selection; when the full list does not fit at 5.5pt the ranked selection prints with the fixed Passport pointer line.
${b.extra.map((x) => `- ${x}`).join("\n")}
`;

const EV_DOCS: Record<string, EvDoc> = {
  cadillac: {
    title: "Cadillac 2026 Escalade IQL Premium Sport (electric)", mode: "electric", logo: "Cadillac logo",
    page: "the reference PDF is 1224x792pt (17x11in landscape); the render is the same size and exactly one page.",
    sample: "- stress record: a saved 2026 Tesla Model Y (other make), not a production candidate. Production has no Cadillac record. The standard-equipment list is trimmed to about 100 items.",
    extra: ["Shared General Motors layout family (gmTruckCommon.ts) with a Cadillac wordmark header and the CARB panel. As an electricity-only vehicle it prints A+ for both ratings, the value CARB fixes for zero-emission vehicles, never an estimate."],
  },
  fiat: {
    title: "Fiat 2025 500e Giorgio Armani (electric)", mode: "electric", logo: "Fiat logo",
    page: "the reference PDF is 1224x792pt (17x11in landscape); the render is the same size and exactly one page.",
    sample: "- stress record: a saved 2024 Tesla Model Y Performance (other make, off-year), not a production candidate. Production has no Fiat record. The standard-equipment list is trimmed to about 100 items.",
    extra: ["The reference is a 2025 example (reference_is_2025); the template matches 2025 only, so a 2026 500e is flagged unsupported.", "Shared FCA layout family (fcaCommon.ts); the FlexCare advertisement slot carries the Passport QR."],
  },
  spectre: {
    title: "Rolls-Royce 2026 Spectre (electric)", mode: "electric", logo: "Rolls-Royce monogram",
    page: "the reference PDF is stored rotated (reference_stored_rotated) and has no text layer; the render is upright at 1224x792pt and exactly one page.",
    sample: "- stress record: a saved 2023 Subaru Solterra (off-year, other make), not a production candidate. Production has no Rolls-Royce record. The standard-equipment list is trimmed to about 100 items.\n- the reference's printed total (474,050.00) exceeds the sum of its printed lines (395,000.00 + 38,200.00 options + 2,750.00 destination = 435,950.00) by 38,100.00; the reference sample does not reconcile, and the reference-match fixture keeps the printed total.",
    extra: ["Values for the reference-match fixture were read from the raster because the reference has no text layer (no_text_layer_in_reference).", "Carrier, port of entry and VPC lines are not reproduced."],
  },
  bentley: {
    title: "Bentley 2026 Continental GT Azure (plug-in hybrid)", mode: "plug-in hybrid", logo: "Bentley winged emblem",
    page: "the reference PDF is 1159.29x697.01pt (page_size_nonstandard); the render keeps that page size and is exactly one page, with the green frame and the banner and disclosure on white strips inside it.",
    sample: "- stress record: a saved 2018 Chevrolet Volt (off-year, other make; also used for the Lamborghini), not a production candidate. Production has no Bentley record. The Volt's options may not reconcile to its stated total.",
    extra: ["The tagline, the winged emblem and the 'affixed pursuant to' statement are not reproduced.", "The parts-content box moves to the lower left so the electric panel keeps its full height (the plug-in panel needs that height to avoid overlapping text).", "The reference's total range is printed only when the record carries it (range_chart_pending)."],
  },
  urus: {
    title: "Lamborghini 2026 Urus SE (plug-in hybrid)", mode: "plug-in hybrid", logo: "Lamborghini shield",
    page: "the reference PDF is stored rotated (reference_stored_rotated) and has no text layer; the render is upright at 1224x792pt and exactly one page.",
    sample: "- stress record: a saved 2018 Chevrolet Volt (off-year, other make; also used for the Bentley), not a production candidate. Production has no Lamborghini record. The Volt's options may not reconcile to its stated total.",
    extra: ["The importer block, stock status and gas guzzler line are not reproduced.", "The reference's sample sticker prints values read from its raster (no text layer)."],
  },
};


const saved = (index: number): FactoryStickerRenderData => {
  const fx = loadFixture();
  const listing = buildListing(fx, fx.vehicles[index]);
  return normalizeForSticker(listing, {}, passportUrlFor(listing), NEW_TITLE).data;
};

const packages: PackageSpec[] = [{
  templateId: HYUNDAI_TUCSON_GAS_ID,
  dirName: "hyundai-2026-tucson-gas",
  build: () => ({ real: tucsonListings().map(tucsonRenderData), realLabel: "real saved record", reference: referenceMatchData }),
  mappingMd: TUCSON_MAPPING,
  differencesMd: TUCSON_DIFFERENCES,
}, {
  templateId: JEEP_WRANGLER_GAS_ID,
  dirName: "jeep-2026-wrangler-gas",
  build: () => ({
    real: [wranglerRenderData()],
    realLabel: "off-year layout stress test (2023 record), not a production candidate",
    reference: wranglerReferenceMatchData,
  }),
  mappingMd: WRANGLER_MAPPING,
  differencesMd: WRANGLER_DIFFERENCES,
}, {
  templateId: CHRYSLER_VOYAGER_GAS_ID,
  dirName: "chrysler-2026-voyager",
  build: () => ({
    real: [voyagerRenderData()],
    realLabel: "off-year, other-model layout stress test (2014 Town & Country record), not a production candidate",
    reference: voyagerReferenceMatchData,
  }),
  mappingMd: VOYAGER_MAPPING,
  differencesMd: VOYAGER_DIFFERENCES,
}, {
  templateId: MITSUBISHI_OUTLANDER_SPORT_ID,
  dirName: "mitsubishi-2026-outlander-sport",
  build: () => ({
    real: [outlanderSportRenderData()],
    realLabel: "off-year, other-model layout stress test (2024 Eclipse Cross record), not a production candidate",
    reference: outlanderSportReferenceMatchData,
  }),
  mappingMd: OUTLANDER_MAPPING,
  differencesMd: OUTLANDER_DIFFERENCES,
}, ...([
  [KIA_SORENTO_GAS_ID, "kia-2026-sorento", "sorento", () => [sorentoRenderData()], "off-year layout stress test (2024 Sorento S record), not a production candidate", sorentoReferenceMatchData],
  [SUBARU_FORESTER_GAS_ID, "subaru-2026-forester", "forester", () => [foresterRenderData()], "off-year layout stress test (2021 Forester Premium record), not a production candidate", foresterReferenceMatchData],
  [GENESIS_GV80_GAS_ID, "genesis-2026-gv80", "gv80", () => [gv80RenderData()], "off-year, other-model layout stress test (2024 G70 record), not a production candidate", gv80ReferenceMatchData],
  [DODGE_DURANGO_GAS_ID, "dodge-2026-durango", "durango", () => [durangoRenderData()], "off-year, other-model layout stress test (2008 Grand Caravan record), not a production candidate", durangoReferenceMatchData],
  [BUICK_ENVISTA_GAS_ID, "buick-2026-envista", "envista", () => [envistaRenderData()], "SYNTHETIC stress fixture (no saved Buick record exists), not a real vehicle", envistaReferenceMatchData],
  [VOLVO_XC60_B5_ID, "volvo-2025-xc60-b5", "volvo", () => [volvoXc60RenderData()], "off-year layout stress test (2022 XC60 Momentum record), not a production candidate", volvoXc60ReferenceMatchData],
  [HONDA_ODYSSEY_GAS_ID, "honda-2026-odyssey", "honda", () => [hondaOdysseyRenderData()], "off-year layout stress test (2025 Odyssey EX-L record), not a production candidate", hondaOdysseyReferenceMatchData],
  [LEXUS_RX350_GAS_ID, "lexus-2026-rx-350", "lexus", () => [lexusRenderData()], "off-year, other-model layout stress test (2024 Lexus GX record), not a production candidate", lexusReferenceMatchData],
  [TOYOTA_4RUNNER_GAS_ID, "toyota-2026-4runner", "toyota4runner", () => [toyota4runnerRenderData()], "off-year layout stress test (2022 4Runner SR5 record), not a production candidate", toyota4runnerReferenceMatchData],
  [ALFA_ROMEO_GIULIA_GAS_ID, "alfa-romeo-2026-giulia", "alfa", () => [alfaRenderData()], "off-year, other-model layout stress test (2020 Stelvio Ti Sport Carbon record), not a production candidate", alfaReferenceMatchData],
  [MASERATI_GRANTURISMO_GAS_ID, "maserati-2026-granturismo", "maserati", () => [maseratiRenderData()], "off-year, other-make layout stress test (2024 Lexus GX record), not a production candidate", maseratiReferenceMatchData],
  [LINCOLN_NAUTILUS_GAS_ID, "lincoln-2026-nautilus", "lincoln", () => [lincolnRenderData()], "off-year, other-model layout stress test (2008 MKZ Base record), not a production candidate", lincolnReferenceMatchData],
  [ASTON_MARTIN_VANTAGE_ROADSTER_GAS_ID, "aston-martin-2026-vantage-roadster", "aston", () => [astonRenderData()], "off-year, other-make layout stress test (2022 Toyota 4Runner SR5 record), not a production candidate", astonReferenceMatchData],
] as const).map(([templateId, dirName, key, real, realLabel, reference]): PackageSpec => ({
  templateId,
  dirName,
  build: () => ({ real: real(), realLabel, reference: reference as (first: FactoryStickerRenderData) => FactoryStickerRenderData }),
  mappingMd: mappingFor(BRAND_DOCS[key]),
  differencesMd: (t) => differencesFor(BRAND_DOCS[key], t),
})), ...([
  [INFINITI_QX60_SPORT_ID, "infiniti-2026-qx60-sport", { title: "INFINITI 2026 QX60 Sport (gasoline), served by the approved master", masterKey: "infiniti-2026-qx60-sport-awd", ownership: "Total Ownership Experience (verified warranty terms)", sample: ["- sticker-5N1AL1FS7TC339685: the saved 2026 INFINITI QX60 LUXE record from the harteNewInventory acceptance fixture (rendered through the sample path, identical to its production render)."] }, () => [saved(0)], "saved production record (2026 INFINITI QX60 LUXE, harteNewInventory fixture)", qx60ReferenceMatchData],
  [NISSAN_PATHFINDER_PLATINUM_ID, "nissan-2026-pathfinder-platinum", { title: "Nissan 2026 Pathfinder Platinum (gasoline), served by the approved master", masterKey: "nissan-2026-pathfinder-platinum-4wd", ownership: "Nissan Ownership Information (verified warranty terms)", sample: ["- sticker-5N1DR3DK0TC000002: SYNTHETIC reference-variant vehicle (no saved Nissan record exists in the acceptance fixtures), not a real vehicle."] }, () => [pathfinderReferenceMatchData()], "SYNTHETIC reference-variant vehicle (no saved Nissan record), not a real vehicle", pathfinderReferenceMatchData],
] as const).map(([templateId, dirName, doc, real, realLabel, reference]): PackageSpec => ({
  templateId,
  dirName,
  build: () => ({ real: real(), realLabel, reference: reference as (first: FactoryStickerRenderData) => FactoryStickerRenderData }),
  mappingMd: letterMapping(doc),
  differencesMd: (t) => letterDifferences(doc, t),
})), ...([
  [FORD_F250_DIESEL_ID, "ford-2026-f250", "f250", f250RenderData, "off-year, other-model layout stress test (2024 F-150 record), not a production candidate", f250ReferenceMatchData],
  [RAM_2500_DIESEL_ID, "ram-2026-2500", "ram", ram2500RenderData, "off-year layout stress test (2022 RAM 2500 gasoline record), not a production candidate", ram2500ReferenceMatchData],
  [CHEVROLET_SILVERADO_2500_DIESEL_ID, "chevrolet-2026-silverado-2500", "silverado", silveradoRenderData, "off-year, other-model layout stress test (2023 Tahoe record), not a production candidate", silveradoReferenceMatchData],
  [GMC_SIERRA_3500_DIESEL_ID, "gmc-2026-sierra-3500", "sierra", sierraRenderData, "off-year, other-model layout stress test (2021 Yukon Denali record), not a production candidate", sierraReferenceMatchData],
] as const).map(([templateId, dirName, key, real, realLabel, reference]): PackageSpec => ({
  templateId,
  dirName,
  build: () => ({ real: [real()], realLabel, reference: reference as (first: FactoryStickerRenderData) => FactoryStickerRenderData }),
  mappingMd: hdMappingFor(HD_DOCS[key]),
  differencesMd: (t) => hdDifferencesFor(HD_DOCS[key], t),
})), ...([
  [CADILLAC_ESCALADE_IQL_EV_ID, "cadillac-2026-escalade-iql", "cadillac", cadillacRenderData, "other-make layout stress test (2026 Tesla Model Y record), not a production candidate", cadillacReferenceMatchData],
  [FIAT_500E_EV_ID, "fiat-2025-500e", "fiat", fiatRenderData, "off-year, other-make layout stress test (2024 Tesla Model Y record), not a production candidate", fiatReferenceMatchData],
  [ROLLS_ROYCE_SPECTRE_EV_ID, "rolls-royce-2026-spectre", "spectre", spectreRenderData, "off-year, other-make layout stress test (2023 Subaru Solterra record), not a production candidate", spectreReferenceMatchData],
  [BENTLEY_CONTINENTAL_GT_PHEV_ID, "bentley-2026-continental-gt", "bentley", bentleyRenderData, "off-year, other-make layout stress test (2018 Chevrolet Volt record), not a production candidate", bentleyReferenceMatchData],
  [LAMBORGHINI_URUS_PHEV_ID, "lamborghini-2026-urus", "urus", urusRenderData, "off-year, other-make layout stress test (2018 Chevrolet Volt record), not a production candidate", urusReferenceMatchData],
] as const).map(([templateId, dirName, key, real, realLabel, reference]): PackageSpec => ({
  templateId,
  dirName,
  build: () => ({ real: [real()], realLabel, reference: reference as (first: FactoryStickerRenderData) => FactoryStickerRenderData }),
  mappingMd: evMappingFor(EV_DOCS[key]),
  differencesMd: (t) => evDifferencesFor(EV_DOCS[key], t),
}))];

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
  await sh("pdftoppm", ["-r", "150", "-png", "-singlefile", pdfPath, pngBase]);
  const info = await sh("pdfinfo", [pdfPath]);
  const size = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(info)!;
  const pages = Number(/Pages:\s+(\d+)/.exec(info)![1]);
  const qr = m.pages[0].primitives.find((p) => p.kind === "qr") as { size: number; payload: string } | undefined;
  const barcode = m.pages[0].primitives.find((p) => p.kind === "barcode") as { payload: string } | undefined;
  const p = data.pricing;
  const calculated = p.baseMsrp !== null
    ? p.baseMsrp + (p.optionsTotal ?? 0) + (p.portOptionsTotal ?? 0) + (p.destinationCharge ?? 0) + (p.gasGuzzlerTax ?? 0) + (p.importCharge ?? 0)
    : null;
  const refInfo = await sh("pdfinfo", [refPdf]);
  const refSize = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(refInfo)!;
  const refRot = Number(/Page rot:\s+(\d+)/.exec(refInfo)?.[1] ?? 0);
  const storedSideways = refRot === 0 && Number(refSize[1]) < Number(refSize[2]) && Number(size[1]) > Number(size[2]);
  const refUpright: [number, number] = refRot === 90 || refRot === 270 || storedSideways ? [Number(refSize[2]), Number(refSize[1])] : [Number(refSize[1]), Number(refSize[2])];
  return {
    name, label, referenceOnly, vin: data.vin,
    pages,
    pageSizePt: [Number(size[1]), Number(size[2])],
    pageSizeInches: [Number(size[1]) / 72, Number(size[2]) / 72],
    referencePageSizePt: refUpright,
    pageSizeEqualsReference: Math.abs(Number(size[1]) - refUpright[0]) < 0.02 && Math.abs(Number(size[2]) - refUpright[1]) < 0.02,
    smallestFontPt: smallestFont(m),
    equipment: m.fit.ok ? { scope: m.fit.equipmentScope, ...m.fit.equipmentCounts, fontPt: m.fit.equipmentFontPt } : null,
    passportQr: qr ? { sizeInches: qr.size / 72, payload: qr.payload } : null,
    barcodePayloadIsVin: barcode?.payload === data.vin,
    textOverlapCheck: overlapResult(m),
    textOutsidePage: outOfBounds(m),
    pricing: {
      baseMsrp: p.baseMsrp, factoryOptionsTotal: p.optionsTotal, destinationCharge: p.destinationCharge,
      ...(p.gasGuzzlerTax != null ? { gasGuzzlerTax: p.gasGuzzlerTax } : {}),
      ...(p.importCharge != null ? { importCharge: p.importCharge } : {}),
      calculatedTotal: calculated, printedTotal: p.totalMsrp,
      reconciled: calculated !== null && p.totalMsrp !== null && Math.abs(calculated - p.totalMsrp) <= 5,
      optionLines: data.options.length,
    },
  };
}

describe.skipIf(!DIR)("OEM template evidence", () => {
  const root = DIR!;
  const samplePath = new Map<string, string>();
  const only = process.env.OEM_TEMPLATES_ONLY?.split(",").filter(Boolean);

  for (const spec of packages) {
    it.skipIf(Boolean(only) && !only!.includes(spec.templateId))(`writes the sample package for ${spec.templateId}`, async () => {
      const outDir = join(root, "samples", spec.dirName) + "/";
      mkdirSync(outDir, { recursive: true });
      const t = TEMPLATE_CATALOG.find((x) => x.id === spec.templateId)!;
      const refSrc = join(root, "reference-pdfs", t.referencePdf);
      const refPdf = join(outDir, "reference.pdf");
      copyFileSync(refSrc, refPdf);
      const built = spec.build();
      const real = built.real;
      const matchData = built.reference(real[0]);
      const results: Array<Record<string, unknown>> = [];
      for (const d of real) results.push(await writeSample(spec, outDir, refPdf, d, built.realLabel, false));
      results.push(await writeSample(spec, outDir, refPdf, matchData, "reference-match (visual comparison only)", true));

      await sh("pdftoppm", ["-r", "100", "-png", "-singlefile", refPdf, join(outDir, "_ref100")]);
      if (t.page.widthPt > t.page.heightPt && /Page size:\s+([\d.]+) x ([\d.]+) pts/.test(await sh("pdfinfo", [refPdf]))) {
        const rs = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(await sh("pdfinfo", [refPdf]))!;
        if (Number(rs[1]) < Number(rs[2]) && Number(/Page rot:\s+(\d+)/.exec(await sh("pdfinfo", [refPdf]))?.[1] ?? 0) === 0) await sh("convert", [join(outDir, "_ref100.png"), "-rotate", t.id === HONDA_ODYSSEY_GAS_ID ? "270" : "90", join(outDir, "_ref100.png")]);
      }
      await sh("pdftoppm", ["-r", "100", "-png", "-singlefile", join(outDir, "reference-match.pdf"), join(outDir, "_match100")]);
      await sh("montage", [
        "-label", "OEM reference (original PDF)", join(outDir, "_ref100.png"),
        "-label", "AutoLabels reference-match render", join(outDir, "_match100.png"),
        "-tile", "2x1", "-geometry", "+12+12", "-pointsize", "26", join(outDir, "side-by-side.png"),
      ]);
      for (const f of ["_ref100.png", "_match100.png"]) await sh("rm", ["-f", join(outDir, f)]);

      writeFileSync(join(outDir, "data-source-mapping.md"), spec.mappingMd);
      writeFileSync(join(outDir, "differences.md"), spec.differencesMd(t));
      writeFileSync(join(outDir, "verification.json"), JSON.stringify({
        template: t.id, rendererPath: "buildRenderLayout sampleTemplateId (pending approval; production routing excludes it)",
        generatedBy: "src/lib/factorySticker/__acceptance__/oemTemplateEvidence.test.ts",
        vehicles: results,
      }, null, 2));
      samplePath.set(t.id, `samples/${spec.dirName}/`);
    }, 120000);
  }

  it("writes the coverage matrix", () => {
    const prod = JSON.parse(readFileSync(join(__dirname, "catalogProdCounts.fixture.json"), "utf8")) as {
      rows: Array<{ make: string; model: string; year: string; fuel: string; body: string; n: number }>;
    };
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
