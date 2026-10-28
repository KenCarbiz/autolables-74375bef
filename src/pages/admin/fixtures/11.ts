import type { AdminScreenFixture } from "./index";
import { DEFAULT_DOCUMENT_RULES } from "@/lib/documentRules";
import { knownCount } from "@/lib/admin/health";
import type { ApprovalRulesFixture } from "@/pages/admin/views/documents/ApprovalRulesView";
import type { DocumentsReadinessFixture } from "@/pages/admin/views/documents/readiness";
import type { TemplatesFixture } from "@/pages/admin/views/documents/TemplatesView";

// Screen 11: Documents & Service, Approval rules tab. Synthetic data only.

const NOW = Date.UTC(2031, 2, 20, 15, 0, 0);

const approvalRules: ApprovalRulesFixture = {
  rules: { ...DEFAULT_DOCUMENT_RULES, requireApprovalBeforePrint: true },
  gates: { k208Required: true, k208Roles: ["service_manager"], licenseeCertification: false, installVerification: true },
  selected: "addendum",
  lastChange: { at: "2031-03-12T14:00:00Z", by: "Example Manager", action: "settings_updated" },
  impact: { activeVehicles: knownCount(48), policyVersion: 4 },
  pendingDraft: { autoUnpublishStale: true },
  canEdit: true,
};

const readiness: DocumentsReadinessFixture = {
  calibration: { kind: "known", saved: true, savedAt: "2031-03-10T09:00:00Z", testedAt: null },
  templatesConfigured: knownCount(4),
  disclosuresMissing: knownCount(2),
  policyVersion: 4,
  versionCheck: "fixture",
};

const templates: TemplatesFixture = {
  catalog: [
    { id: "example-window-classic", name: "Example Window Classic", type: "window", size: "8.5x11", active: true, currentVersion: 3, publishedAt: "2031-03-01T12:00:00Z" },
    { id: "example-addendum-strip", name: "Example Addendum Strip", type: "addendum", size: "4.5x11", active: true, currentVersion: 1, publishedAt: null },
  ],
};

export const FIXTURE_11: AdminScreenFixture = {
  tabId: "approval-rules",
  fixture: {
    label: "Documents & Service: approval rules",
    now: NOW,
    views: {
      "approval-rules": approvalRules,
      "documents-readiness": readiness,
      templates,
    },
  },
};
