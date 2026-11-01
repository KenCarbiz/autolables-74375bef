import { HEALTH_META, type HealthTone } from "@/lib/admin/health";
import type { IntegrationTiming } from "@/lib/inventoryNetwork/api";
import { describeCron, type CronLookup, type JobRow } from "./jobs";
import type { JobLedgers } from "./queries";

// Jobs & pipelines rows. Permission to run (the schedule), request delivery
// (the scheduler's run record) and completed work (the rooftop's own ledger)
// are three separate columns. Health keeps the jobs rule: a job with its own
// work ledger is judged by that ledger alone, so a delivered request never
// reads as a successful update.

export type PipelineTone = "green" | "amber" | "red" | "blue" | "neutral";
export interface PipelineChip { label: string; tone: PipelineTone }

export interface PipelineRow {
  id: string;
  label: string;
  schedule: string;
  delivery: string;
  work: string;
  health: PipelineChip;
  href: string;
}

const TONE: Record<HealthTone, PipelineTone> = { success: "green", warning: "amber", danger: "red", info: "blue", neutral: "neutral" };

const monthDay = (iso: string): string => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso));

export function cadenceLabel(schedule: string | null): string {
  const text = describeCron(schedule);
  if (text.startsWith("Daily")) return "Daily";
  if (text.startsWith("Hourly")) return "Hourly";
  return text.replace(/, hours .*$/, "");
}

export function scheduleLabel(cron: CronLookup): string {
  if (cron === "unavailable") return "Unknown";
  if (!cron) return "Not scheduled";
  if (cron.active === false) return "Paused";
  return cadenceLabel(cron.schedule);
}

export function deliveryLabel(cron: CronLookup): string {
  if (cron === "unavailable") return "Unknown";
  if (!cron) return "None recorded";
  const status = (cron.last_status ?? "").toLowerCase();
  if (cron.last_start) return `${monthDay(cron.last_start)} · ${status === "succeeded" ? "delivered" : status || "requested"}`;
  if (status === "succeeded") return "Latest request sent";
  return status ? status : "None recorded";
}

export function catalogPipelineRow(row: JobRow, cron: CronLookup, ledgers: JobLedgers, label: string, href: string): PipelineRow {
  const key = row.spec.ledger;
  const read = key ? key in ledgers : false;
  const facts = key ? ledgers[key] ?? null : null;
  const failed = read && facts === null;
  let work: string;
  if (!key) work = row.lastSuccessAt ? `${monthDay(row.lastSuccessAt)} · scheduler record` : "None recorded";
  else if (failed) work = "Unknown";
  else if (!read) work = "Outcome ledger required";
  else if (facts?.lastSuccessAt) work = `${monthDay(facts.lastSuccessAt)} · ${facts.lastOutcome ?? "completed"}`;
  else if (facts?.lastAttemptAt) work = `${monthDay(facts.lastAttemptAt)} · ${facts.lastOutcome ?? "attempted"}`;
  else work = "No tenant action recorded";

  const state = row.verdict.state;
  let health: PipelineChip;
  if (state === "disabled") health = { label: "Paused", tone: "neutral" };
  else if (state === "not_configured") health = { label: "Needs setup", tone: "amber" };
  else if (key && !read && state !== "healthy") health = { label: "Needs evidence", tone: "amber" };
  else if (key && read && facts && !facts.lastSuccessAt && !facts.lastAttemptAt && state === "unknown") health = { label: "No work recorded", tone: "neutral" };
  else health = { label: HEALTH_META[state].label, tone: TONE[HEALTH_META[state].tone] };

  return { id: row.spec.id, label, schedule: scheduleLabel(cron), delivery: deliveryLabel(cron), work, health, href };
}

/** The Files.com import worker: its timing row and newest run. Null means the timeline was not readable. */
export interface FilesWorkerFacts {
  timing: Pick<IntegrationTiming, "import_mode" | "import_cron"> | null;
  lastRun: { at: string; status: string; kind: string } | null;
}

export function filesWorkerRow(facts: FilesWorkerFacts | null, href: string): PipelineRow {
  const base = { id: "files_com_worker", label: "Files.com import worker", href };
  if (!facts) return { ...base, schedule: "Unknown", delivery: "Unknown", work: "Unknown", health: { label: "Unknown", tone: "neutral" } };
  const t = facts.timing;
  const delivery = facts.lastRun ? `${monthDay(facts.lastRun.at)} · ${facts.lastRun.status}` : "None recorded";
  if (!t || (t.import_mode === "manual" && !t.import_cron) || (t.import_mode === "scheduled" && !t.import_cron)) {
    return { ...base, schedule: "Not configured", delivery, work: t?.import_mode === "scheduled" ? "None recorded" : "Manual import only", health: { label: "Needs setup", tone: "amber" } };
  }
  const schedule = t.import_mode === "on_completion" ? "On delivery" : cadenceLabel(t.import_cron);
  const imported = facts.lastRun && facts.lastRun.kind === "import" ? facts.lastRun : null;
  const ok = imported && /^(passed|applied|completed|succeeded)$/i.test(imported.status);
  return {
    ...base, schedule, delivery,
    work: imported ? `${monthDay(imported.at)} · ${imported.status}` : "None recorded",
    health: ok ? { label: "Healthy", tone: "green" } : { label: "Needs evidence", tone: "amber" },
  };
}
