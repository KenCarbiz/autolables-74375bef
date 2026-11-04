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
import { wranglerReferenceMatchData, wranglerRenderData } from "../render/__fixtures__/wrangler";
import { voyagerReferenceMatchData, voyagerRenderData } from "../render/__fixtures__/voyager";
import { outlanderSportReferenceMatchData, outlanderSportRenderData } from "../render/__fixtures__/outlanderSport";
import { CHRYSLER_VOYAGER_GAS_ID } from "../render/variants/chryslerVoyagerGas";
import { MITSUBISHI_OUTLANDER_SPORT_ID } from "../render/variants/mitsubishiOutlanderSport";
import { HYUNDAI_TUCSON_GAS_ID } from "../render/variants/hyundaiTucsonGas";
import { JEEP_WRANGLER_GAS_ID } from "../render/variants/jeepWranglerGas";
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
| Exterior / interior color, engine, transmission, drivetrain | build_sheet.colors; mc_attributes.engine / transmission; drivetrain from sourceCorrections.decideDrivetrain | Row omitted |
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
- Page: the reference is an 11x17 sheet (792x1224pt, rotation 0) carrying a landscape label printed rotated 90 degrees, so its text reads sideways. This layout is upright on the same 792x1224 page with the panels re-stacked (header, fuel economy, safety and parts content, equipment and pricing, footer). The order and content of the panels follow the reference; their positions do not. The owner should confirm that an upright portrait layout is acceptable (page_size_portrait).
- Fonts: Helvetica / Helvetica-Bold stand in for the reference's Arial and DIN-style faces (font_substitution).
- Artwork not reproduced: the 10-year powertrain warranty graphic and its coverage columns, the "Mitsubishi Motors Confidence" included-items list, "Full Tank of Gas INCLUDED", agency seals, the source Smartphone QR (replaced by the Vehicle Passport QR in the footer), the source barcode (regenerated from the VIN), the cumulative accessory weight line, route code, location and the build string.
- Wording not reproduced: the federal-law label statement under the pricing ("This label has been applied to this vehicle pursuant to federal law ...") is not certified here. The footnote reads "Original manufacturer's suggested retail prices shown. Excludes taxes, title, license, dealer-installed items and current selling price."
- EPA panel: native rebuild with the same indicator semantics (1-10 scores, Not Available for anything else); gradient, bubble shape and spacing are approximated, and the average-vehicle MPG and cost sentence is not printed.
- Safety: the decode gives one frontal and one side value, so combined rows print where the reference shows driver/passenger and front/rear seat; the reference-match fixture carries per-row values to show the full panel. The footer wording uses www.nhtsa.gov/ratings where the reference prints safercar.gov.
- Pricing block: prints MSRP, total additional equipment, subtotal, destination/handling and total MSRP from the record; any value the record lacks prints NOT AVAILABLE. The reference-match values reconcile ($24,995 + $455 + $1,795 = $27,245). The stress record reconciles ($27,995 + $410 + $1,445 = $29,850).
- Fields in the reference with no render-data source: the dealer ship-to block (blank unless the original delivering dealer is proven), port of entry (Baltimore), route code, location, accessory weight, build string. Plant/port prints the final assembly point only when the record has one.
- OCR: transcription was spot-checked against the PDF only (ocr_unverified). The reference-match fixture normalizes quotation marks and drops registered and trademark marks.
- Parts content, warranty: not wired by the orchestrator adapter today (blockers parts_content_not_wired, warranty_terms_not_wired); the reference-match render shows the populated state. The stress record shows only the country of final assembly from mc_attributes.made_in.
- Equipment: the reference prints its 26 items under five headings; the stress record prints all 172 at the ladder's compacted size with decoder fragments removed.
- Matching: model Outlander Sport (or RVR), SUV body, gasoline. The full-size Outlander and the Outlander PHEV are not matched and flag template_configuration_unsupported. A record that states no drivetrain still matches.
`;

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
      const built = spec.build();
      const real = built.real;
      const matchData = built.reference(real[0]);
      const results: Array<Record<string, unknown>> = [];
      for (const d of real) results.push(await writeSample(spec, outDir, refPdf, d, built.realLabel, false));
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
