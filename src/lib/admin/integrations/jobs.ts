import { deriveJobHealth, type HealthVerdict } from "@/lib/admin/health";
import { ADMIN_CHILD_ROUTES, adminTabHref } from "@/lib/admin/sections";

// Scheduled jobs and pipelines that affect dealer outputs. A cron row proves
// that a schedule exists; execution for this rooftop is read from the
// rooftop's own ledgers wherever one exists, and from the scheduler's run
// history only where the job has no per-rooftop ledger.

export type JobLedger = "inventory_sync" | "crawl" | "enrich" | "recall" | "description" | "escalation" | null;

export interface JobSpec {
  id: string;
  label: string;
  cronName: string;
  cadenceHours: number;
  affectedOutput: string;
  scope: "This rooftop" | "All rooftops";
  drillIn: string;
  drillInLabel: string;
  ledger: JobLedger;
}

export const JOB_CATALOG: readonly JobSpec[] = [
  { id: "inventory_sync", label: "Inventory sync", cronName: "marketcheck-sync", cadenceHours: 24, affectedOutput: "Inventory freshness", scope: "This rooftop", drillIn: adminTabHref("inventory-feed"), drillInLabel: "Open feed", ledger: "inventory_sync" },
  { id: "price_crawl", label: "Dealer-site price crawl", cronName: "autolabels_crawl_advertised_prices", cadenceHours: 24, affectedOutput: "Dealer-site price evidence", scope: "This rooftop", drillIn: adminTabHref("price-rules", "price-audit"), drillInLabel: "Open pricing", ledger: "crawl" },
  { id: "enrich_sweep", label: "Market intelligence refresh", cronName: "enrich-sweep-nightly", cadenceHours: 24, affectedOutput: "Market value, comparables, build data", scope: "All rooftops", drillIn: adminTabHref("providers"), drillInLabel: "Open providers", ledger: "enrich" },
  { id: "recall_refresh", label: "Recall refresh", cronName: "enrich-sweep-nightly", cadenceHours: 24 * 30, affectedOutput: "VIN recall verification", scope: "This rooftop", drillIn: adminTabHref("data-quality"), drillInLabel: "Open data quality", ledger: "recall" },
  { id: "description_reconcile", label: "Description reconcile", cronName: "description-reconcile-nightly", cadenceHours: 24, affectedOutput: "Merchandising descriptions", scope: "This rooftop", drillIn: "/description-operations", drillInLabel: "Open descriptions", ledger: "description" },
  { id: "lead_escalation", label: "Lead escalation sweep", cronName: "passport-lead-escalation-every-5-min", cadenceHours: 1, affectedOutput: "Unanswered lead escalation", scope: "All rooftops", drillIn: ADMIN_CHILD_ROUTES.escalation, drillInLabel: "Open escalation", ledger: "escalation" },
  { id: "incentives", label: "OEM incentives refresh", cronName: "marketcheck-incentives", cadenceHours: 24, affectedOutput: "Incentive context", scope: "All rooftops", drillIn: adminTabHref("price-rules"), drillInLabel: "Open price rules", ledger: null },
  { id: "specs_backfill", label: "Build sheet backfill", cronName: "specs-backfill", cadenceHours: 24, affectedOutput: "Exact build and equipment", scope: "All rooftops", drillIn: "/inventory-intelligence", drillInLabel: "Open inventory intelligence", ledger: null },
  { id: "factory_sticker", label: "Factory sticker sweep", cronName: "factory-sticker-sweep", cadenceHours: 24, affectedOutput: "Factory build records", drillIn: adminTabHref("templates"), drillInLabel: "Open templates", scope: "All rooftops", ledger: null },
  { id: "title_reminders", label: "Title reminders", cronName: "title-reminders-sweep", cadenceHours: 24, affectedOutput: "Title and MCO follow-up", scope: "All rooftops", drillIn: adminTabHref("service-policy"), drillInLabel: "Open service policy", ledger: null },
  { id: "price_drop", label: "Price-drop re-engagement", cronName: "price-drop-reengage", cadenceHours: 24, affectedOutput: "Shopper price-drop emails", scope: "All rooftops", drillIn: adminTabHref("store-settings"), drillInLabel: "Open store settings", ledger: null },
  { id: "passport_delivery", label: "Passport delivery flush", cronName: "passport-delivery-flush", cadenceHours: 1, affectedOutput: "Customer document delivery", scope: "All rooftops", drillIn: adminTabHref("approval-rules"), drillInLabel: "Open approval rules", ledger: null },
  { id: "get_ready", label: "Get-Ready sweep", cronName: "get-ready-sweep", cadenceHours: 24, affectedOutput: "Service and prep dispatch", scope: "All rooftops", drillIn: "/get-ready-command", drillInLabel: "Open Get Ready", ledger: null },
];

export interface CronStatusRow {
  jobname: string;
  schedule: string | null;
  active: boolean | null;
  last_status: string | null;
  last_message: string | null;
  last_start: string | null;
  last_end: string | null;
}

export interface LedgerFacts {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastOutcome: string | null;
  lastRunId?: string | null;
}

export type CronLookup = CronStatusRow | null | "unavailable";

export interface JobInput {
  spec: JobSpec;
  cron: CronLookup;
  ledger: LedgerFacts | null;
  ledgerLoadFailed?: boolean;
  /** Newest scheduler run that succeeded. Request delivery only; never a rooftop outcome. */
  schedulerLastSuccessAt?: string | null;
  now: number;
}

export interface JobRow {
  spec: JobSpec;
  verdict: HealthVerdict;
  schedule: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastOutcome: string | null;
  lastRunId: string | null;
  /** Where the success evidence came from. */
  evidence: "rooftop_ledger" | "scheduler" | "none";
}

const later = (a: string | null, b: string | null): string | null => {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
};

export function deriveJobRow(i: JobInput): JobRow {
  const cron = i.cron === "unavailable" ? null : i.cron;
  const cronKnown = i.cron !== "unavailable";
  const ledger = i.ledger;
  const schedulerSucceeded = i.schedulerLastSuccessAt ?? (cron?.last_status?.toLowerCase() === "succeeded" ? cron.last_start : null);
  const lastSuccessAt = ledger?.lastSuccessAt ?? (i.spec.ledger === null ? schedulerSucceeded : null);
  const evidence: JobRow["evidence"] = ledger?.lastSuccessAt ? "rooftop_ledger" : lastSuccessAt ? "scheduler" : "none";
  const verdict = deriveJobHealth({
    scheduled: cronKnown ? !!cron : null,
    active: cron ? cron.active : null,
    lastAttemptAt: later(ledger?.lastAttemptAt ?? null, cron?.last_start ?? null),
    lastSuccessAt,
    lastOutcome: ledger?.lastOutcome ?? cron?.last_status ?? null,
    cadenceHours: i.spec.cadenceHours,
    affectedOutput: i.spec.affectedOutput,
    now: i.now,
    loadFailed: !!i.ledgerLoadFailed && !cron,
  });
  return {
    spec: i.spec,
    verdict,
    schedule: cron?.schedule ?? null,
    lastAttemptAt: later(ledger?.lastAttemptAt ?? null, cron?.last_start ?? null),
    lastSuccessAt,
    lastOutcome: ledger?.lastOutcome ?? cron?.last_status ?? null,
    lastRunId: ledger?.lastRunId ?? null,
    evidence,
  };
}

/** Plain-English cron, for the common shapes the app schedules. */
export function describeCron(schedule: string | null): string {
  if (!schedule) return "Schedule not readable";
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return schedule;
  const [min, hour, dom, mon, dow] = parts;
  if (dom !== "*" || mon !== "*" || dow !== "*") return schedule;
  if (min.startsWith("*/") && hour === "*") return `Every ${min.slice(2)} minutes`;
  if (min.startsWith("*/")) return `Every ${min.slice(2)} minutes, hours ${hour} UTC`;
  if (hour === "*" && /^\d+$/.test(min)) return `Hourly at :${min.padStart(2, "0")}`;
  if (/^\d+$/.test(hour) && /^\d+$/.test(min)) return `Daily at ${hour.padStart(2, "0")}:${min.padStart(2, "0")} UTC`;
  return schedule;
}
