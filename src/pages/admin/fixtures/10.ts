import type { AdminScreenFixture } from "./index";
import type { PublishingFixture } from "@/pages/admin/views/publishing/usePublishingData";

// Reference screen 10, Publishing policy. Synthetic: an example rooftop with
// intake auto-publish on, manager approval before publishing on, the used/CPO
// inspection gate on, a draft that differs from the enforced policy.

const views: Record<string, PublishingFixture> = {
  "effective-policy": {
    rooftopLabel: "Example Auto Group (Example City, ST)",
    settings: {
      ingest_auto_publish: true,
      require_safety_inspection: true,
      require_k208_licensee_certification: false,
      require_install_verification: true,
      k208_authority_roles: ["service_manager", "general_manager"],
      feature_price_verification: false,
      document_rules: { requireApprovalBeforePublish: true, autoPublishApprovedWindow: false, autoPublishApprovedAddendum: false, autoUnpublishStale: false, hideSupersededPublic: true },
    },
    description: { reviewMode: "manual_review", reviewModeByClass: { new: "manual_review", used: "manual_review", cpo: "manual_review" }, internalPublicationEnabled: true },
    counts: {
      activeByClass: { new: { kind: "known", value: 79 }, used: { kind: "known", value: 31 }, cpo: { kind: "known", value: 20 } },
      publishedByClass: { new: { kind: "known", value: 79 }, used: { kind: "known", value: 29 }, cpo: { kind: "known", value: 20 } },
    },
    selectedClass: "used",
    draftPending: true,
    policyVersion: 12,
  },
};

const fixture: AdminScreenFixture = {
  tabId: "effective-policy",
  fixture: { label: "10 Publishing policy", now: Date.parse("2026-10-28T15:00:00Z"), views },
};

export default fixture;
