// Generates the Passport data crosswalk and the VIN acceptance report from the
// field registry and the stored, sanitized production fixtures. Read-only; no
// network, no database.
//
//   bun scripts/passport-coverage-report.ts <out-dir>

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import rows from "../src/lib/vehicleData/__fixtures__/acceptanceVehicles.json";
import { FIELD_REGISTRY } from "../src/lib/vehicleData/fieldRegistry";
import { assessPassportCoverage } from "../src/lib/vehicleData/passportCoverage";
import { structuredSheet } from "../supabase/functions/_shared/neovinSheet";
import { derivePassport } from "../src/lib/passportV2Data";
import { buildVehiclePassportDataContract } from "../src/lib/vehicleData/dataContract";
import { buildNextPassportData } from "../src/lib/passport/nextPassportData";
import { deriveVerificationReport } from "../src/lib/passport/verificationSummary";
import { buildPassportSaleCard } from "../src/lib/passport/saleCard";
import type { VehicleListing } from "../src/hooks/useVehicleListing";

type Bag = Record<string, unknown>;
const out = process.argv[2] || "passport-report";
mkdirSync(out, { recursive: true });
const esc = (s: unknown) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

// Crosswalk
const groups = [...new Set(FIELD_REGISTRY.map((r) => r.group))];
const counts = (st: string) => FIELD_REGISTRY.filter((r) => r.status === st).length;
let cw = `# Passport field crosswalk\n\nGenerated from src/lib/vehicleData/fieldRegistry.ts. ${FIELD_REGISTRY.length} fields: `
  + ["working", "partial", "missing", "blocked", "excluded"].map((s) => `${counts(s)} ${s}`).join(", ") + ".\n\n";
for (const g of groups) {
  cw += `## ${g}\n\n| Field | Destination | Status | Where it goes / why not |\n|---|---|---|---|\n`;
  for (const r of FIELD_REGISTRY.filter((x) => x.group === g)) cw += `| \`${esc(r.path)}\` | ${r.destination} | ${r.status} | ${esc(r.note)} |\n`;
  cw += "\n";
}
writeFileSync(join(out, "field-crosswalk.md"), cw);

// VIN acceptance
const money = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);
let va = "# VIN acceptance report\n\nStored production data (read-only export, Nov 6 2026) → normalized columns → shared Passport model → Passport V2 sections. "
  + "\"Rehydrated\" rows re-run structuredSheet over the stored NeoVIN snapshot (zero-cost, not applied in production).\n\n";
for (const raw of rows as Bag[]) {
  for (const rehydrate of [false, true]) {
    if (rehydrate && !raw.neovin) continue;
    const mc = { ...(raw.mc_attributes as Bag) };
    if (rehydrate) mc.build_sheet = structuredSheet(raw.neovin);
    const l = { ...raw, mc_attributes: mc, status: "published" } as unknown as VehicleListing;
    const d = derivePassport(l);
    const contract = buildVehiclePassportDataContract(l, d);
    const saleCard = buildPassportSaleCard(d, String(raw.condition));
    const next = buildNextPassportData({ d, listing: l as never, report: deriveVerificationReport(d, l), saleCard, gallery: [], contract });
    const cov = assessPassportCoverage(l, raw.neovin);
    va += `## ${raw.ymm} ${raw.trim ?? ""} · ${raw.condition} · ${raw.vin}${rehydrate ? " (rehydrated build sheet)" : ""}\n\n`;
    va += `- Dealer price ${money(Number(raw.price))}; V2 price ${money(next.price.current)}; market value ${money(d.marketAvg)}${d.marketBasisWeak ? " (weak basis, no verdict)" : ""}\n`;
    va += `- Equipment: ${next.equipment.basis}, ${next.equipment.featureCount} features, ${next.equipment.packages.length} packages, ${next.equipment.options.length} options, ${next.equipment.notVerified.length} not verified installed; options value ${money(next.equipment.optionsValue)}\n`;
    va += `- Factory MSRP: ${next.factoryMsrp.status} → ${next.factoryMsrp.state}${next.factoryMsrp.total ? ` ${money(next.factoryMsrp.total)}` : ""}${next.factoryMsrp.note ? ` (${next.factoryMsrp.note})` : ""}\n`;
    va += `- Fuel: ${next.fuel.state}${next.fuel.combined != null ? ` ${next.fuel.combined} combined ${next.fuel.unit}` : ""}; Recalls: ${next.recalls.status} (${esc(next.recalls.label)}); Warranty: ${next.warranty.state}; History timeline: ${next.timeline.events.map((e) => `${e.label} [${e.status}]`).join(", ") || "pending"}\n`;
    va += `- Coverage: ${cov.categories.map((c) => `${c.label} ${c.status}`).join(" · ")}\n`;
    const held = cov.categories.filter((c) => c.holdReason);
    if (held.length) va += `- Holds: ${held.map((c) => `${c.label}: ${esc(c.holdReason)}`).join(" / ")}\n`;
    va += "\n";
  }
}
writeFileSync(join(out, "vin-acceptance.md"), va);
console.log(`wrote ${join(out, "field-crosswalk.md")} and ${join(out, "vin-acceptance.md")}`);
