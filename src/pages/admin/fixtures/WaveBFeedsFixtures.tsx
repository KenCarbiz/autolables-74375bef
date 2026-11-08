import type { AdminFixture } from "@/lib/admin/dataSource";
import type { DealerSettings } from "@/contexts/DealerSettingsContext";
import type { PriceTestResult } from "@/pages/admin/views/brand/feeds/priceTest";
import type { ArchiveRow } from "@/pages/admin/views/brand/feeds/templateRegistry";
import { STUDIO_TEMPLATES } from "@/lib/stickerStudio/templates";
import { STUDIO_SATURDAY_TEMPLATES } from "@/lib/stickerStudio/saturdayTemplates";
import { PE_PUBLISHED } from "./paymentEstimator";
import { FIXTURE_02 } from "./02";
import type { AdminScreenFixture } from "./index";

// Design fixtures for Websites & feeds, Document defaults and Store settings. Every name, address and value is
// invented for screenshots, uses reserved example domains, and is never written anywhere. ?state= selects a
// variant: default, empty, invalid, readonly, error, partial, paused, match, missing, ambiguous, variant, none, broken.

const NOW = Date.parse("2026-11-07T15:00:00Z");
const brand = FIXTURE_02.fixture.views.brand as Record<string, unknown>;

const SAMPLE_URLS: Partial<DealerSettings> = {
  dms_provider: "Example DMS",
  new_inventory_url: "https://www.example-motors.example/new-inventory",
  used_inventory_url: "https://www.example-motors.example/used-inventory",
  autotrader_url: "https://www.autotrader.com/example-dealer",
  cars_com_url: "",
  cargurus_url: "https://www.cargurus.com/Cars/example-dealer",
  capital_one_url: "",
  carfax_url: "https://www.carfax.com/example-dealer",
  vdp_price_labels: "Internet Price, Selling Price, Sale Price",
  vdp_strip_finance_params: true,
  vehicle_conditions: "New, Demo, Used, CPO",
};

const BLANK_URLS: Partial<DealerSettings> = {
  dms_provider: "", new_inventory_url: "", used_inventory_url: "", autotrader_url: "", cars_com_url: "", cargurus_url: "", capital_one_url: "", carfax_url: "",
  vdp_price_labels: "", vdp_strip_finance_params: true, vehicle_conditions: "",
};

const candidates = (rows: Array<[number, string, string]>) => rows.map(([value, label, source]) => ({ value, label, source }));

const priceResults: Record<string, PriceTestResult> = {
  match: { price: 28450, matched_label: "Internet Price", source: "dom_label", reason: null, rendered: false, http_status: 200, msrp: 31200, strip_finance_params: true, configured_labels: ["Internet Price", "Selling Price", "Sale Price"], candidates: candidates([[28450, "Internet Price", "dom_label"], [31200, "MSRP", "dom_label"], [412, "Est. payment per month", "dom_label"]]) },
  variant: { price: 28450, matched_label: "Internet Price", source: "dom_label", reason: null, rendered: true, http_status: 200, msrp: 31200, strip_finance_params: true, configured_labels: ["Internet Price", "Selling Price", "Sale Price"], candidates: candidates([[28450, "Internet Price", "dom_label"], [27990, "Cash price after rebates", "dom_label"], [29995, "Finance price", "dom_label"], [31200, "MSRP", "dom_label"]]) },
  missing: { price: null, matched_label: null, source: "none", reason: "unlabeled_price_only", rendered: false, http_status: 200, msrp: 31200, strip_finance_params: true, configured_labels: ["Internet Price", "Selling Price", "Sale Price"], candidates: candidates([[28450, "(unlabeled)", "dom_label"], [31200, "MSRP", "dom_label"]]) },
  ambiguous: { price: null, matched_label: "Selling Price", source: "none", reason: "ambiguous_price", rendered: false, http_status: 200, strip_finance_params: true, configured_labels: ["Internet Price", "Selling Price", "Sale Price"], candidates: candidates([[28450, "Selling Price", "dom_label"], [29995, "Selling Price", "dom_label"]]) },
  paused: { paused: true, error: "Temporarily paused for pricing verification" },
};

const websitesFixture = (label: string): AdminFixture => ({
  label,
  now: NOW,
  views: {
    brand: { ...brand, settings: SAMPLE_URLS },
    "websites-feeds": {
      seeds: {
        empty: BLANK_URLS,
        invalid: { ...SAMPLE_URLS, new_inventory_url: "ftp://files.example.com/new", used_inventory_url: "not a web address", autotrader_url: "https://www.cargurus.com/Cars/example-dealer", cars_com_url: "https://localhost/listing", vdp_price_labels: "Internet Price, internet price" },
        partial: { ...SAMPLE_URLS, vehicle_conditions: "New, Demo, Used, CPO, Wholesale, Loaner" },
      },
      results: priceResults,
    },
  },
});

const ARCHIVE: ArchiveRow[] = [
  { template_key: "window-premium", is_active: true, current_version: 3 },
  { template_key: "addendum-modern", is_active: true, current_version: 2 },
  { template_key: "addendum-saturday-premium", is_active: true, current_version: 1 },
  { template_key: "window-modern", is_active: true, current_version: 4 },
  { template_key: "addendum-value", is_active: false, current_version: 2 },
];

const docsFixture = (label: string): AdminFixture => ({
  label,
  now: NOW,
  views: {
    brand: {
      ...brand,
      settings: {
        label_defaults: { addendum_new: "studio:addendum-modern", addendum_used: "studio:addendum-saturday-premium", window_used: "studio:window-premium", window_new: "builder:new-car-sticker" },
        default_ftc_warranty: "as_is", default_new_addendum: "standard", default_used_window: "standard", default_used_addendum: "standard",
      },
    },
    "document-defaults": {
      archive: ARCHIVE,
      templates: [...STUDIO_TEMPLATES, ...STUDIO_SATURDAY_TEMPLATES],
      paymentEstimator: { storeName: "Example INFINITI", storeId: "store-example-1", otherStores: [], published: { config: PE_PUBLISHED, version: 3, updatedAt: "2026-10-28T15:42:00Z" }, vehicles: [], canManage: true, priceContext: {} },
      seeds: {
        none: { label_defaults: {}, default_ftc_warranty: "as_is" },
        broken: { label_defaults: { addendum_new: "studio:addendum-retired-example", addendum_used: "studio:addendum-value", window_used: "studio:window-premium", window_new: "builder:new-car-sticker" } },
        partial: { default_ftc_warranty: "dealer" },
      },
    },
  },
});

const storeFixture = (label: string): AdminFixture => ({
  label,
  now: NOW,
  views: {
    brand: {
      ...brand,
      settings: {
        product_default_mode: "selective", allow_type_override_at_signing: true, getready_drives_addendum: false,
        view_notify_enabled: true, view_notify_email: "sales@example-motors.example, bdc@example-motors.example",
        price_drop_watch_enabled: true, price_drop_emails_enabled: true,
        ingest_auto_publish: true, ingest_recon_dispatch: "manual", ingest_detail_dispatch: "auto",
        detail_email: "detail@example-motors.example", detail_default_instructions: "", service_email: "service@example-motors.example", service_default_instructions: "",
        thirdparty_auto_notify: true,
        feature_vin_decode: true, feature_vin_barcode: true, feature_product_icons: true, feature_product_rules: true, feature_buyers_guide: true,
        feature_spanish_buyers_guide: true, feature_multilang_buyers_guide: false, feature_lead_capture: true, feature_cobuyer_signature: true,
        feature_ink_saving: false, feature_url_scrape: true, feature_custom_branding: true, feature_inventory: true, feature_invoicing: false,
        feature_warranty: true, feature_analytics: true, feature_sms: false, feature_blackbook: false,
      },
    },
    "store-settings": {
      seeds: {
        empty: {
          product_default_mode: "selective", allow_type_override_at_signing: false, getready_drives_addendum: false, view_notify_enabled: false, view_notify_email: "",
          price_drop_watch_enabled: false, price_drop_emails_enabled: false, ingest_auto_publish: false, ingest_recon_dispatch: "manual", ingest_detail_dispatch: "manual",
          detail_email: "", service_email: "", thirdparty_auto_notify: false,
          feature_vin_decode: false, feature_vin_barcode: false, feature_product_icons: false, feature_product_rules: false, feature_buyers_guide: false,
          feature_spanish_buyers_guide: false, feature_multilang_buyers_guide: false, feature_lead_capture: false, feature_cobuyer_signature: false, feature_ink_saving: false,
          feature_url_scrape: false, feature_custom_branding: false, feature_inventory: false, feature_invoicing: false, feature_warranty: false, feature_analytics: false,
        },
        invalid: { view_notify_email: "sales@example-motors.example, not-an-email", detail_email: "a@example.com, b@example.com, c@example.com, d@example.com", service_email: "service-at-example" },
        partial: { ingest_auto_publish: false, feature_buyers_guide: false },
      },
    },
  },
});

export const WAVE_B_FEEDS_FIXTURES: Record<string, AdminScreenFixture> = {
  "v3-websites-feeds": { tabId: "websites-feeds", fixture: websitesFixture("Websites & feeds (v3)") },
  "v3-document-defaults": { tabId: "document-defaults", fixture: docsFixture("Document defaults (v3)") },
  "v3-store-settings": { tabId: "store-settings", fixture: storeFixture("Store settings (v3)") },
};
