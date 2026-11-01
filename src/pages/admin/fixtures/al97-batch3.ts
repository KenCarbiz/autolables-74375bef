import type { AdminScreenFixture } from "./index";
import { ADMIN_CHILD_ROUTES } from "@/lib/admin/sections";
import { knownCount } from "@/lib/admin/health";
import { assessConsistency, type ConsistencyListing, type WebsiteObservation } from "@/lib/admin/pricing/priceConsistency";
import type { PricingIntegrityFixture } from "@/pages/admin/children/PricingIntegrityPage";
import type { VehicleFilesFixture } from "@/pages/admin/children/VehicleFilesPage";
import type { JobsPipelinesFixture } from "@/pages/admin/children/JobsPipelinesPage";
import type { JobsViewFixture } from "@/pages/admin/views/integrations/JobsView";
import type { CronStatusRow } from "@/lib/admin/integrations/jobs";

// AL97 screens 07, 21, 08, 24, 09 and 10. Synthetic design fixtures only:
// vehicles, stock numbers, file ids, counts and times are invented for the
// parity harness, are labelled synthetic on screen, and are never written.

const NOW = Date.parse("2026-10-31T21:25:00Z");
const ACCOUNT = "Harte Auto Group";
const STORE = "Harte INFINITI";

const screen = (childPath: string, label: string, views: Record<string, unknown>): AdminScreenFixture => ({ childPath, fixture: { label, now: NOW, views } });

const listing = (n: number, over: Partial<ConsistencyListing> = {}): ConsistencyListing => {
  const stock = `DEMO${String(n).padStart(2, "0")}`;
  return {
    id: `pl-${n}`, vin: `DEMO0000000000${String(n).padStart(3, "0")}`, year: 2024, make: "Example", model: "SUV", trim: null, stock, condition: "used",
    heroImageUrl: null, price: 30000, advertisedBeforeDoc: 29105, docFee: 895, websiteSalePrice: 30000, parseStatus: "ok",
    verifiedAt: "2026-10-31T18:00:00Z", vehicleFileId: `vf-${n}`, ...over,
  };
};
const seen = (price: number): WebsiteObservation => ({ price, capturedAt: "2026-10-31T19:00:00Z", sourceUrl: null, channel: "website" });
const MODE = "website_sale_price" as const;

const readyRows = Array.from({ length: 24 }, (_, i) => {
  const n = i + 1;
  const observation = n === 2 || n >= 21 ? null : n === 3 ? seen(30500) : seen(30000);
  return assessConsistency(listing(n), observation, 895, MODE);
});

const pricing = (over: Partial<PricingIntegrityFixture>): PricingIntegrityFixture => ({
  account: ACCOUNT, store: STORE,
  policy: { feeEnabled: true, feeAmount: 895, mode: MODE, feeBasis: "includes_fee" },
  counts: { active: knownCount(24), eligible: knownCount(24), archived: knownCount(0) },
  consistency: { rows: readyRows, truncated: false },
  checkedAt: "2026-10-31T21:20:00Z",
  ...over,
});

export const AL97_07 = screen(ADMIN_CHILD_ROUTES.pricingIntegrity, "AL97 07 Pricing integrity", {
  "pricing-integrity": pricing({
    counts: { active: knownCount(152), eligible: knownCount(128), archived: knownCount(200) },
    consistency: null,
    error: "column vehicle_listings.year does not exist",
  }),
  "al97-copy": {
    "pricing.problem": "Reader requests year / make / model",
    "pricing.failedSave": "Repair reads first. A screenshot match does not approve a pricing-policy migration.",
  },
});

export const AL97_21 = screen(ADMIN_CHILD_ROUTES.pricingIntegrity, "AL97 21 Pricing integrity ready", {
  "pricing-integrity": pricing({}),
  "al97-copy": {
    caption: " · synthetic pricing fixture",
    "pricing.activeSub": "Synthetic store population",
    "pricing.previewFine": "Illustrative fee-inclusive fixture.",
    "pricing.pageIdentity": "Confirmed in fixture",
    "pricing.checkedAt": "Fixed fixture clock",
    "pricing.readySave": "Reader repaired; prices unchanged",
  },
});

const vf = (over: Partial<VehicleFilesFixture>): VehicleFilesFixture => ({ account: ACCOUNT, store: STORE, storeId: "st-1", rows: [], stats: null, ...over });

export const AL97_08 = screen(ADMIN_CHILD_ROUTES.vehicleFiles, "AL97 08 Vehicle files", {
  "vehicle-files": vf({
    stats: { tenantTotal: 330, storeAssigned: 0, unassigned: 330 },
    rows: [
      { id: "DEMO-001", storeId: null, evidence: ["Signed document", "provider cache"] },
      { id: "DEMO-002", storeId: null, evidence: ["Inspection", "QR link"] },
      { id: "DEMO-003", storeId: null, evidence: ["Vehicle data only"] },
    ],
  }),
  "al97-copy": { "files.queueNote": "Synthetic examples only. No production VINs or customer details in this target." },
});

export const AL97_24 = screen(ADMIN_CHILD_ROUTES.vehicleFiles, "AL97 24 Vehicle files associated", {
  "vehicle-files": vf({
    stats: { tenantTotal: 330, storeAssigned: 280, unassigned: 50 },
    providerRepulls: 0,
    rows: [
      { id: "DEMO-001", storeId: "st-1", evidence: ["Signed docs", "QR", "provider cache"] },
      { id: "DEMO-002", storeId: "st-1", evidence: ["Inspection", "customer route"] },
      { id: "DEMO-003", storeId: null, evidence: ["Vehicle data only"] },
    ],
  }),
  "al97-copy": {
    caption: " · synthetic association fixture",
    "files.totalSub": "No records deleted",
    "files.storeSub": "Illustrative reviewed result",
    "files.associatedDetail": "This synthetic result demonstrates retained identifiers and evidence after reviewed associations.",
    "files.registryNote": "280 / 50 is an illustrative split, not a computed production proposal.",
  },
});

const cron = (jobname: string, schedule: string, active: boolean, lastStart: string | null): CronStatusRow => ({
  jobname, schedule, active, last_status: "succeeded", last_message: null, last_start: lastStart, last_end: lastStart,
});
const JOBS: JobsViewFixture = {
  status: {
    source: "admin_job_status",
    serverLedger: {},
    cron: {
      "marketcheck-sync": cron("marketcheck-sync", "7 6 * * *", false, "2026-10-29T10:07:00Z"),
      autolabels_crawl_advertised_prices: cron("autolabels_crawl_advertised_prices", "0 7 * * *", false, "2026-10-29T11:00:00Z"),
      "description-reconcile-nightly": cron("description-reconcile-nightly", "30 4 * * *", true, null),
      "passport-lead-escalation-every-5-min": cron("passport-lead-escalation-every-5-min", "*/5 * * * *", true, null),
    },
  },
  ledgers: {
    inventory_sync: { lastAttemptAt: "2026-10-03T10:07:00Z", lastSuccessAt: "2026-10-03T10:09:00Z", lastOutcome: "completed" },
    crawl: { lastAttemptAt: "2026-10-29T11:00:00Z", lastSuccessAt: "2026-10-29T11:20:00Z", lastOutcome: "captured" },
    escalation: { lastAttemptAt: null, lastSuccessAt: null, lastOutcome: null },
  },
};

export const AL97_09 = screen(ADMIN_CHILD_ROUTES.jobs, "AL97 09 Jobs and pipelines", {
  jobs: JOBS,
  "al97-jobs": { account: ACCOUNT, store: STORE, filesWorker: { timing: { import_mode: "manual", import_cron: null }, lastRun: null } } satisfies JobsPipelinesFixture,
  "al97-copy": { "jobs.note": "Illustrative normalized statuses based on the inspection. Read actual timestamps at runtime." },
});
