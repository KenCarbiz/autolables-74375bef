import type { AdminFixture } from "@/lib/admin/dataSource";
import type { PublishingFixture } from "@/pages/admin/views/publishing/usePublishingData";
import type { DestinationsFixture } from "@/pages/admin/views/publishing/useDescriptionSettings";
import type { AdminScreenFixture } from "./index";

// Design fixtures for Publishing: Effective policy, Destinations and automation, and Description settings. Every
// name and value is invented, uses reserved example domains, and is never written anywhere. ?state= selects a
// variant: default, empty, invalid, readonly, error, blocked.

const NOW = Date.parse("2026-11-07T15:00:00Z");

const known = (value: number) => ({ kind: "known" as const, value });
const failed = { kind: "failed" as const };

const policyBase: PublishingFixture = {
  rooftopLabel: "Example Honda (Example City, ST)",
  groupLabel: "Example Auto Group",
  settings: {
    ingest_auto_publish: true,
    require_safety_inspection: true,
    require_k208_licensee_certification: false,
    require_install_verification: true,
    k208_authority_roles: ["service_manager", "general_manager"],
    feature_price_verification: false,
    document_rules: { requireApprovalBeforePublish: true, autoPublishApprovedWindow: false, autoPublishApprovedAddendum: false, autoUnpublishStale: false, hideSupersededPublic: true },
  },
  description: { reviewMode: "EXCEPTION_REVIEW", reviewModeByClass: { used: "REQUIRE_APPROVAL_ALL", demo: "DRAFT_ONLY" }, internalPublicationEnabled: true },
  counts: {
    activeByClass: { new: known(79), used: known(31), cpo: known(20) },
    publishedByClass: { new: known(79), used: known(29), cpo: known(20) },
  },
  selectedClass: "used",
  draftPending: false,
  policyVersion: 12,
  history: [
    {
      id: "h1", at: "2026-11-03T14:12:00Z", actor: "owner@example.com", keys: ["requireApprovalBeforePublish", "hideSupersededPublic"], version: 11,
      prev: { requireApprovalBeforePublish: false, hideSupersededPublic: false }, next: { requireApprovalBeforePublish: true, hideSupersededPublic: true },
    },
    {
      id: "h2", at: "2026-10-21T19:40:00Z", actor: "gm@example.com", keys: ["ingest_auto_publish"], version: 10,
      prev: { ingest_auto_publish: false }, next: { ingest_auto_publish: true },
    },
  ],
  seeds: {
    empty: {
      counts: { activeByClass: { new: known(0), used: known(0), cpo: known(0) }, publishedByClass: { new: known(0), used: known(0), cpo: known(0) } },
      description: { reviewMode: null, reviewModeByClass: {}, internalPublicationEnabled: null },
      settings: { ...({} as PublishingFixture["settings"]), ingest_auto_publish: true, document_rules: undefined },
    },
    invalid: { draftPending: true },
    readonly: { draftPending: false },
    error: {
      description: null,
      counts: { activeByClass: { new: failed, used: failed, cpo: failed }, publishedByClass: { new: failed, used: failed, cpo: failed } },
    },
    blocked: {
      draftPending: true,
      counts: { activeByClass: { new: known(79), used: failed, cpo: known(20) }, publishedByClass: { new: known(79), used: failed, cpo: known(20) } },
    },
  },
};

const policyFixture = (label: string): AdminFixture => ({ label, now: NOW, views: { "effective-policy": policyBase } });

const nameOf = "Example Honda";

const rowBase = {
  review_mode: "EXCEPTION_REVIEW",
  review_mode_by_class: { used: "REQUIRE_APPROVAL_ALL", demo: "DRAFT_ONLY" },
  enabled_channels: ["vehicle_passport", "dealer_website", "autotrader", "cargurus", "facebook", "google_seo", "vauto"],
  internal_publication_enabled: true,
  brand_voice: "Friendly, plain spoken and specific. We describe what the car has, not how to feel about it.",
  default_tone: "professional",
  dealer_name_format: "",
  primary_city: "",
  state: "",
  cta_template: "Call or visit Example Honda to schedule a test drive.",
  required_legal_text: "Advertised price includes the documentation fee. Taxes and registration are additional.",
  prohibited_phrases: ["guaranteed financing", "lowest price"],
  min_length: 400,
  max_length: 2400,
  class_rules: {},
  warranty_language_allowed: true,
  cpo_language_allowed: false,
  accessory_language_allowed: false,
  market_context_allowed: false,
  price_in_description: false,
  quality_threshold: 70,
  updated_at: "2026-11-03T14:12:00Z",
};

const destinationsBase = (section: "automation" | "description"): DestinationsFixture => ({
  section,
  rooftopLabel: nameOf,
  groupLabel: "Example Auto Group",
  identity: { name: "Example Honda", city: "Example City", state: "ST" },
  row: rowBase,
  seeds: {
    empty: null,
    invalid: { ...rowBase, min_length: 3000, max_length: 2000, quality_threshold: 140, prohibited_phrases: ["lowest price", "Lowest Price"], required_legal_text: "We guarantee the lowest price on every vehicle.", cta_template: "Ask about our lowest price today." },
    blocked: { ...rowBase, review_mode: "DRAFT_ONLY", internal_publication_enabled: false, cta_template: "Hurry before this one is gone, call Example Honda." },
  },
  deliveries: [
    { id: "d1", destination: "vehicle_passport", status: "delivered", delivery_mode: "internal_projection", attempt_count: 1, published_at: "2026-11-06T16:20:00Z", failed_at: null, created_at: "2026-11-06T16:20:00Z" },
    { id: "d2", destination: "vehicle_passport", status: "failed", delivery_mode: "internal_projection", attempt_count: 2, published_at: null, failed_at: "2026-11-05T13:05:00Z", created_at: "2026-11-05T13:04:00Z", response_metadata: { error: "The listing was archived before the description could be written." } },
    { id: "d3", destination: "vauto", status: "delivered", delivery_mode: "export_only", attempt_count: 1, published_at: "2026-11-04T18:00:00Z", failed_at: null, created_at: "2026-11-04T18:00:00Z" },
    { id: "d4", destination: "autotrader", status: "delivered", delivery_mode: "export_only", attempt_count: 1, published_at: "2026-10-30T15:10:00Z", failed_at: null, created_at: "2026-10-30T15:10:00Z" },
  ],
  profileOverrides: { dealer_website: { recommendedMin: 1800, recommendedMax: 3000 } },
  cached: [
    { channel: "vehicle_passport", character_count: 1742, validation_status: "passed", created_at: "2026-11-06T16:19:00Z" },
    { channel: "vauto", character_count: 3921, validation_status: "passed", created_at: "2026-11-04T17:58:00Z" },
    { channel: "autotrader", character_count: 1204, validation_status: "passed", created_at: "2026-10-30T15:08:00Z" },
  ],
});

const destinationsFixture = (label: string, section: "automation" | "description"): AdminFixture => ({ label, now: NOW, views: { destinations: destinationsBase(section) } });

export const WAVE_C_PUBLISHING_FIXTURES: Record<string, AdminScreenFixture> = {
  "v3-effective-policy": { tabId: "effective-policy", fixture: policyFixture("Effective policy (v3)") },
  "v3-destinations": { tabId: "destinations", fixture: destinationsFixture("Destinations and automation (v3)", "automation") },
  "v3-description-settings": { tabId: "destinations", fixture: destinationsFixture("Description settings (v3)", "description") },
};
