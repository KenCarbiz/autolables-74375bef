import { ADMIN_CHILD_ROUTES } from "@/lib/admin/sections";
import { buildVautoExport, checkPriceDisclosure, rulesFor, type StoreDisclosure } from "@/lib/description/vautoExport";
import {
  SYNTHETIC_APPROVED_DISCLOSURE, SYNTHETIC_CTA, SYNTHETIC_DISCLOSURE, SYNTHETIC_DISCLOSURE_TEMPLATE, SYNTHETIC_FACTS, SYNTHETIC_NARRATIVE,
  SYNTHETIC_PENDING_DISCLOSURE, SYNTHETIC_PRICE_ROW, SYNTHETIC_SETTINGS, SYNTHETIC_STORE, SYNTHETIC_VEHICLE,
} from "@/lib/description/vautoSyntheticExample";
import type { EngineDisclosure, EngineFixture } from "@/pages/admin/views/descriptions/engineData";
import type { AdminScreenFixture } from "./index";

// Synthetic Description Engine screens. Nothing here is real store data.
//   description-engine           counsel approval SIMULATED: everything agrees
//   description-engine-pending   the proposed CT wording awaiting legal review
//   description-engine-conflict  an old exclusion disclosure that contradicts the price

const NOW = Date.parse("2026-11-04T14:00:00Z");
const OLD_TEMPLATE = "Price excludes tax, title, registration and dealer documentation fee.";
const SOUTH = { id: "store-synthetic-south", name: "Example Motors South", state: "CT" };

const exportText = () => {
  const price = checkPriceDisclosure({ settings: SYNTHETIC_SETTINGS, row: SYNTHETIC_PRICE_ROW, disclosureText: SYNTHETIC_DISCLOSURE_TEMPLATE, rules: rulesFor("CT") });
  return buildVautoExport({ narrative: SYNTHETIC_NARRATIVE, cta: SYNTHETIC_CTA, disclosure: { text: SYNTHETIC_DISCLOSURE, version: "fixture", approved: true }, price }).text;
};

const asEngine = (d: StoreDisclosure, id: string, n: number): EngineDisclosure => ({ ...d, id, versionNumber: n, version: String(n) });

const WEBSITE = `${SYNTHETIC_NARRATIVE}\n\n${SYNTHETIC_CTA}\n\n${SYNTHETIC_DISCLOSURE}`;
const PASSPORT = SYNTHETIC_NARRATIVE.split(". ").slice(0, 14).join(". ") + ".";

const vehicle = { id: SYNTHETIC_VEHICLE.id, label: SYNTHETIC_VEHICLE.label, vin: SYNTHETIC_VEHICLE.vin, stock: SYNTHETIC_VEHICLE.stock, storeId: SYNTHETIC_STORE.id, price: SYNTHETIC_PRICE_ROW, observed: 28995 };

const base = (disclosures: EngineDisclosure[], vautoText: string | null): EngineFixture => ({
  storeName: SYNTHETIC_STORE.name,
  dealerSettings: SYNTHETIC_SETTINGS,
  descriptionSettings: { cta_template: SYNTHETIC_CTA },
  voice: {
    status: "approved", version: "voice_3f2a91c0", tone: "professional",
    history: [
      { version: "voice_3f2a91c0", status: "approved", createdAt: "2026-10-30T15:12:00Z", reason: "Added service department claims" },
      { version: "voice_1b77e204", status: "superseded", createdAt: "2026-10-12T09:40:00Z", reason: "Initial voice" },
    ],
  },
  stores: [
    { id: SYNTHETIC_STORE.id, name: SYNTHETIC_STORE.name, state: SYNTHETIC_STORE.state, overridesVersion: 2, overrides: { cta_template: SYNTHETIC_CTA, brand_voice: "professional" } },
    { id: SOUTH.id, name: SOUTH.name, state: SOUTH.state, overridesVersion: null, overrides: {} },
  ],
  disclosures,
  vehicles: [vehicle],
  details: {
    [vehicle.id]: {
      caseId: "case-synthetic-1",
      masterVersionId: "master-synthetic-3",
      vautoChannelVersionId: "cv-3",
      vautoText,
      narrative: SYNTHETIC_NARRATIVE,
      facts: SYNTHETIC_FACTS.map((f) => ({ id: f.id, label: f.label, value: f.value, source: f.source, status: f.status })),
      channels: [
        { id: "cv-3", channel: "vauto", content: vautoText ?? "", characterCount: vautoText ? [...vautoText].length : null, validationStatus: "passed" },
        { id: "cv-web", channel: "dealer_website", content: WEBSITE, characterCount: [...WEBSITE].length, validationStatus: "passed" },
        { id: "cv-pass", channel: "vehicle_passport", content: PASSPORT, characterCount: [...PASSPORT].length, validationStatus: "passed" },
      ],
      evidence: { factSnapshot: true, openBlockingExceptions: 0, openBlockingFindings: 0, potentiallyStale: false },
      exportApproved: false,
      versions: [
        { id: "cv-3", createdAt: "2026-11-04T13:40:00Z", characterCount: vautoText ? [...vautoText].length : null, validationStatus: vautoText ? "passed" : "failed", policyVersion: "cp_vauto_2", manualEdit: false, approval: "pending" },
        { id: "cv-2", createdAt: "2026-10-31T21:05:00Z", characterCount: 3921, validationStatus: "passed", policyVersion: "cp_vauto_2", manualEdit: false, approval: "pending" },
        { id: "cv-1", createdAt: "2026-10-28T10:15:00Z", characterCount: 3604, validationStatus: "warning", policyVersion: "cp_vauto_1", manualEdit: false, approval: "rejected" },
      ],
    },
  },
  canApprove: true,
  canConfigure: true,
});

const screen = (label: string, f: EngineFixture): AdminScreenFixture => ({
  childPath: ADMIN_CHILD_ROUTES.descriptionEngine,
  fixture: { label, now: NOW, views: { "description-engine": f } },
});

const OLD: StoreDisclosure = { ...SYNTHETIC_APPROVED_DISCLOSURE, template: OLD_TEMPLATE };

export const DESCRIPTION_ENGINE_FIXTURES: Record<string, AdminScreenFixture> = {
  "description-engine": screen("Description Engine: counsel approval simulated, everything agrees",
    base([asEngine(SYNTHETIC_APPROVED_DISCLOSURE, "disc-2", 2), asEngine({ ...SYNTHETIC_PENDING_DISCLOSURE, status: "retired" }, "disc-1", 1)], exportText())),
  "description-engine-pending": screen("Description Engine: proposed CT wording awaiting legal review",
    base([asEngine(SYNTHETIC_PENDING_DISCLOSURE, "disc-1", 1)], exportText())),
  "description-engine-conflict": screen("Description Engine: disclosure contradicts the price",
    base([asEngine(OLD, "disc-old", 1)], exportText())),
};
