import { ADMIN_CHILD_ROUTES } from "@/lib/admin/sections";
import { buildVautoExport, checkPriceDisclosure } from "@/lib/description/vautoExport";
import {
  SYNTHETIC_CTA, SYNTHETIC_DISCLOSURE, SYNTHETIC_FACTS, SYNTHETIC_NARRATIVE, SYNTHETIC_PRICE_ROW, SYNTHETIC_SETTINGS, SYNTHETIC_STORE, SYNTHETIC_VEHICLE,
} from "@/lib/description/vautoSyntheticExample";
import type { EngineFixture } from "@/pages/admin/views/descriptions/engineData";
import type { AdminScreenFixture } from "./index";

// Synthetic Description Engine screens: one vehicle whose price breakdown,
// description, disclosure and export agree, and the same vehicle under the
// old exclusion disclosure, which blocks. Nothing here is real store data.

const NOW = Date.parse("2026-11-01T14:00:00Z");
const OLD_DISCLOSURE = "Price excludes tax, title, registration and dealer documentation fee.";

const exportFor = (disclosure: string) => {
  const price = checkPriceDisclosure({ settings: SYNTHETIC_SETTINGS, row: SYNTHETIC_PRICE_ROW, disclosureText: SYNTHETIC_DISCLOSURE });
  return buildVautoExport({ narrative: SYNTHETIC_NARRATIVE, cta: SYNTHETIC_CTA, disclosure: { text: disclosure, version: "fixture", approved: true }, price }).text;
};

const vehicle = { id: SYNTHETIC_VEHICLE.id, label: SYNTHETIC_VEHICLE.label, vin: SYNTHETIC_VEHICLE.vin, stock: SYNTHETIC_VEHICLE.stock, price: SYNTHETIC_PRICE_ROW, observed: 28995 };

const base = (disclosure: string, vautoText: string | null): EngineFixture => ({
  storeName: SYNTHETIC_STORE.name,
  dealerSettings: SYNTHETIC_SETTINGS,
  descriptionSettings: { required_legal_text: disclosure, cta_template: SYNTHETIC_CTA },
  voice: {
    status: "approved", version: "voice_3f2a91c0", tone: "professional",
    history: [
      { version: "voice_3f2a91c0", status: "approved", createdAt: "2026-10-30T15:12:00Z", reason: "Added service department claims" },
      { version: "voice_1b77e204", status: "superseded", createdAt: "2026-10-12T09:40:00Z", reason: "Initial voice" },
    ],
  },
  vehicles: [vehicle],
  details: {
    [vehicle.id]: {
      caseId: "case-synthetic-1",
      masterVersionId: "master-synthetic-3",
      vautoText,
      narrative: SYNTHETIC_NARRATIVE,
      facts: SYNTHETIC_FACTS.map((f) => ({ id: f.id, label: f.label, value: f.value, source: f.source, status: f.status })),
      versions: [
        { id: "cv-3", createdAt: "2026-11-01T13:40:00Z", characterCount: vautoText ? [...vautoText].length : null, validationStatus: vautoText ? "passed" : "failed", policyVersion: "cp_vauto_2", manualEdit: false, approval: "pending" },
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

export const DESCRIPTION_ENGINE_FIXTURES: Record<string, AdminScreenFixture> = {
  "description-engine": screen("Description Engine: verified fee-inclusive example", base(SYNTHETIC_DISCLOSURE, exportFor(SYNTHETIC_DISCLOSURE))),
  "description-engine-conflict": screen("Description Engine: disclosure contradicts the price", base(OLD_DISCLOSURE, exportFor(OLD_DISCLOSURE))),
};
