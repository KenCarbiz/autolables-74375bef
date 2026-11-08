import type { AdminFixture } from "@/lib/admin/dataSource";
import { DEFAULT_DOCUMENT_RULES } from "@/lib/documentRules";
import { knownCount } from "@/lib/admin/health";
import type { HubDocRow, HubInspectionRow, HubListing } from "@/lib/admin/documentsHubModel";
import type { HubSnapshot } from "@/pages/admin/views/documents/hub/hubData";
import type { DocumentsHubFixture } from "@/pages/admin/views/documents/hub/useHubData";
import type { ApprovalRulesFixture } from "@/pages/admin/views/documents/ApprovalRulesView";
import type { ServicePolicyFixture } from "@/pages/admin/views/documents/ServicePolicyView";
import type { DocumentsReadinessFixture } from "@/pages/admin/views/documents/readiness";
import type { TemplatesFixture } from "@/pages/admin/views/documents/TemplatesView";
import type { AdminScreenFixture } from "./index";

// Design fixtures for Documents & Service: the hub, Approval rules and Service
// policy. Every name, VIN, id and address is invented, uses reserved example
// domains, makes no network request and is never written anywhere. ?state=
// selects a variant: default, empty, invalid, readonly, error, blocked.

const NOW = Date.parse("2026-11-07T15:00:00Z");

const MAKES = ["Example Sedan", "Example Crossover", "Example Pickup", "Example Hatchback"];

const pad = (n: number, w = 4) => String(n).padStart(w, "0");
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();

function buildSnapshot(): HubSnapshot {
  const listings: HubListing[] = [];
  const docs: HubDocRow[] = [];
  const inspections: HubInspectionRow[] = [];
  const stock: Record<string, string> = {};
  const cycle = ["published", "approved", "published", "pending_approval", "published", "draft", "approved", "missing", "published", "rejected", "approved"] as const;
  for (let i = 1; i <= 64; i++) {
    const id = `fx-veh-${pad(i)}`;
    const condition = i % 3 === 0 ? "new" : i % 5 === 0 ? "cpo" : "used";
    const used = condition !== "new";
    const fileId = `fx-file-${pad(i)}`;
    stock[fileId] = `EX${pad(1000 + i)}`;
    listings.push({
      id,
      vin: `1EXAMPLE${pad(i, 9)}`,
      ymm: `${2020 + (i % 7)} ${MAKES[i % MAKES.length]}`,
      condition,
      status: i % 4 === 0 ? "draft" : "published",
      open_recall_count: i % 17 === 0 ? 1 : 0,
      vehicle_file_id: fileId,
      updated_at: iso(i % 30),
    });
    const winStatus = cycle[i % cycle.length];
    if (winStatus !== "missing") {
      docs.push({ id: `fx-doc-w-${pad(i)}`, vehicle_id: id, document_type: used ? "window" : "factory_sticker", document_status: winStatus, version: 1 + (i % 3), template_id: used ? "example-window-classic" : "example-factory-monroney", template_version: 3, created_at: iso(i % 40), rejection_reason: winStatus === "rejected" ? "Price does not match the listing" : null });
      if (i % 6 === 1) docs.push({ id: `fx-doc-w0-${pad(i)}`, vehicle_id: id, document_type: used ? "window" : "factory_sticker", document_status: "superseded", version: 1, template_id: "example-window-classic", template_version: 2, created_at: iso(60), superseded_at: iso(45) });
    }
    if (used) {
      const bgStatus = cycle[(i + 2) % cycle.length];
      if (bgStatus !== "missing") docs.push({ id: `fx-doc-b-${pad(i)}`, vehicle_id: id, document_type: "buyers_guide", document_status: bgStatus, version: 1, template_id: "example-buyers-guide", template_version: 1, created_at: iso(i % 25) });
      const k = i % 4;
      if (k === 0) inspections.push({ id: `fx-insp-${pad(i)}`, vehicle_listing_id: id, status: "signed", result: "pass", signed_at: iso(10), created_at: iso(12), inspector_name: "Example Technician", form_type: "k208" });
      if (k === 1) inspections.push({ id: `fx-insp-${pad(i)}`, vehicle_listing_id: id, status: "pending", result: null, signed_at: null, created_at: iso(3), form_type: "k208" });
      if (k === 2 && i % 8 === 2) inspections.push({ id: `fx-insp-${pad(i)}`, vehicle_listing_id: id, status: "signed", result: "fail", signed_at: iso(5), created_at: iso(6), inspector_name: "Example Technician", form_type: "k208" });
      if (k === 3) inspections.push({ id: `fx-insp-${pad(i)}`, vehicle_listing_id: id, status: "signed", result: "pass", signed_at: iso(20), created_at: iso(21), inspector_name: "Example Technician", form_type: "k208" });
    }
  }
  return { listings, docs, inspections, stock, complete: true, totalActive: listings.length };
}

const snapshot = buildSnapshot();

const history: DocumentsHubFixture["history"] = Object.fromEntries(
  snapshot.listings.slice(0, 64).map((l) => [l.id, { docs: snapshot.docs.filter((d) => d.vehicle_id === l.id).sort((a, b) => ((a.created_at ?? "") < (b.created_at ?? "") ? 1 : -1)), inspections: snapshot.inspections.filter((r) => r.vehicle_listing_id === l.id) }]),
);

const readiness: DocumentsReadinessFixture = {
  calibration: { kind: "known", saved: true, savedAt: iso(20), testedAt: null },
  templatesConfigured: knownCount(3),
  disclosuresMissing: knownCount(2),
  policyVersion: 12,
  versionCheck: "fixture",
};

const templates: TemplatesFixture = {
  catalog: [
    { id: "example-window-classic", name: "Example Window Classic", type: "window", size: "8.5x11", active: true, currentVersion: 3, publishedAt: iso(30) },
    { id: "example-factory-monroney", name: "Example Factory Monroney", type: "factory_sticker", size: "8.5x11", active: true, currentVersion: 1, publishedAt: iso(80) },
    { id: "example-addendum-strip", name: "Example Addendum Strip", type: "addendum", size: "4.25x11", active: true, currentVersion: 2, publishedAt: null },
  ],
};

const hubFixture = (): AdminFixture => ({
  label: "Documents & Service hub (v3)",
  now: NOW,
  views: {
    "documents-hub": { rooftopLabel: "Example Honda (Example City, ST)", snapshot, history } satisfies DocumentsHubFixture,
    "documents-readiness": readiness,
    templates,
    "service-policy": { policy: servicePolicyBase().policy, title: servicePolicyBase().title, impact: { activeVehicles: knownCount(64), policyVersion: 12 } } satisfies ServicePolicyFixture,
  },
});

const approvalBase = (): ApprovalRulesFixture => ({
  rules: { ...DEFAULT_DOCUMENT_RULES, requireApprovalBeforePrint: true },
  gates: { k208Required: true, k208Roles: ["service_manager", "general_manager"], licenseeCertification: false, installVerification: true },
  selected: "window_sticker",
  lastChange: { at: iso(4), by: "owner@example.com", action: "settings_updated" },
  impact: { activeVehicles: knownCount(64), policyVersion: 12 },
  dirtyDraft: { autoUnpublishStale: true },
  invalidDraft: { requireApprovalBeforePublish: false, autoPublishApprovedWindow: true },
  canEdit: true,
  history: [
    { id: "h1", at: iso(4), by: "owner@example.com", keys: ["requireApprovalBeforePrint"] },
    { id: "h2", at: iso(33), by: "gm@example.com", keys: ["staleOnPriceChange", "autoUnpublishStale"] },
  ],
  rooftopLabel: "Example Honda (Example City, ST)",
});

const approvalFixture = (): AdminFixture => ({
  label: "Approval rules (v3)",
  now: NOW,
  views: { "approval-rules": approvalBase(), "documents-readiness": readiness, templates },
});

function servicePolicyBase(): ServicePolicyFixture {
  return {
    policy: {
      require_safety_inspection: true,
      k208_authority_roles: ["service_manager", "general_manager"],
      require_k208_licensee_certification: false,
      require_install_verification: true,
      recon_auto_approve_amount: 500,
      recon_approval_email: "used-cars@example.com, gm@example.com",
      prep_require_ro: true,
      prep_detail_photos_required: true,
      prep_service_photo_tasks: "Mud flaps installed, Running boards installed",
    },
    title: {
      title_clerk_email: "titles@example.com, backup-clerk@example.com",
      title_email_on_intake: true,
      title_round_robin: true,
      title_reminders_enabled: true,
      title_reminder_days: 3,
    },
    impact: { activeVehicles: knownCount(64), policyVersion: 12 },
    canEdit: true,
    canEditOps: true,
    dirtyDraft: { recon_approval_email: "used-cars@example.com, gm@example.com, controller@example.com" },
    invalidDraft: { k208_authority_roles: [], recon_approval_email: "used-cars@example.com, not-an-email" },
    products: [
      { id: "fx-prod-0001", name: "Mud flaps installed", badge_type: "installed" },
      { id: "fx-prod-0002", name: "Running boards installed", badge_type: "installed" },
      { id: "fx-prod-0003", name: "Paint protection installed", badge_type: "installed" },
      { id: "fx-prod-0004", name: "Window tint installed", badge_type: "installed" },
    ],
    reminders: [
      { id: "fx-rem-1", vin: "1EXAMPLE000000007", at: iso(1) },
      { id: "fx-rem-2", vin: "1EXAMPLE000000011", at: iso(3) },
      { id: "fx-rem-3", vin: "1EXAMPLE000000007", at: iso(4) },
    ],
    rooftopLabel: "Example Honda (Example City, ST)",
  };
}

const serviceFixture = (): AdminFixture => ({
  label: "Service policy (v3)",
  now: NOW,
  views: { "service-policy": servicePolicyBase(), "documents-readiness": readiness },
});

export const WAVE_D_DOCS_FIXTURES: Record<string, AdminScreenFixture> = {
  "v3-documents-hub": { tabId: "templates", fixture: hubFixture() },
  "v3-approval-rules": { tabId: "approval-rules", fixture: approvalFixture() },
  "v3-service-policy": { tabId: "service-policy", fixture: serviceFixture() },
};
