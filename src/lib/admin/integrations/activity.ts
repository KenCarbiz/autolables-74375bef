import type { HealthTone } from "@/lib/admin/health";

// The operational ledger: audit rows typed as configuration changes or
// provider and job events, paginated, with the actor named honestly.

export type ActivityKind = "configuration" | "provider_job" | "other";

export const ACTIVITY_KIND_META: Readonly<Record<ActivityKind, { label: string; tone: HealthTone }>> = {
  configuration: { label: "Configuration", tone: "info" },
  provider_job: { label: "Provider / job", tone: "neutral" },
  other: { label: "Activity", tone: "neutral" },
};

const CONFIG = /setting|polic|role|member|invite|fee|price_rule|routing|template|rule_|branding|feature|k208_authority|config|entitlement|plan_/i;
const PROVIDER_JOB = /sync|pull|crawl|escalat|provider|job|sweep|refresh|recall|enrich|marketcheck|autocurb|notified|generated|publish|export|delivery|reconcile|backfill|cron|budget|refused|rate_limit/i;

/** Server-side narrowing for a kind, as a PostgREST `or` filter over the action name. */
const CONFIG_TERMS = ["setting", "polic", "role", "member", "invite", "fee", "price_rule", "routing", "template", "branding", "feature", "config", "entitlement", "plan_"];
const PROVIDER_JOB_TERMS = ["sync", "pull", "crawl", "escalat", "provider", "job", "sweep", "refresh", "recall", "enrich", "marketcheck", "autocurb", "publish", "export", "delivery", "reconcile", "backfill", "budget", "refused", "rate_limit"];

export function activityServerFilter(kind: ActivityKind | "all"): string | null {
  const terms = kind === "configuration" ? CONFIG_TERMS : kind === "provider_job" ? PROVIDER_JOB_TERMS : null;
  return terms ? terms.map((t) => `action.ilike.%${t}%`).join(",") : null;
}

export function classifyAuditAction(action: string | null | undefined): ActivityKind {
  const a = (action ?? "").toLowerCase();
  if (!a) return "other";
  if (CONFIG.test(a) && !/sync|crawl|sweep/.test(a)) return "configuration";
  if (PROVIDER_JOB.test(a)) return "provider_job";
  return "other";
}

export const humanizeAction = (action: string | null | undefined): string =>
  (action ?? "").replace(/[_.]/g, " ").replace(/\s+/g, " ").trim().replace(/^\w/, (c) => c.toUpperCase()) || "Event";

export interface AuditRow {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  user_id: string | null;
  user_email: string | null;
  created_at: string;
  details: unknown;
}

export const actorLabel = (row: Pick<AuditRow, "user_email" | "user_id">): string => row.user_email || (row.user_id ? "Signed-in user" : "System");

export const entityLabel = (row: Pick<AuditRow, "entity_type" | "entity_id">): string =>
  [row.entity_type, row.entity_id ? row.entity_id.slice(0, 8) : null].filter(Boolean).join(" · ") || "—";

/** Outcome tone for a row, from its action name only. */
export function activityTone(action: string | null | undefined): HealthTone {
  const a = (action ?? "").toLowerCase();
  if (/refus|fail|error|denied|rate_limit|blocked/.test(a)) return "warning";
  if (/complete|success|verified|published|signed/.test(a)) return "success";
  return "neutral";
}

const PAST_TENSE: Readonly<Record<string, string>> = {
  publish: "published", verify: "verified", sign: "signed", generate: "generated", approve: "approved", decline: "declined",
  create: "created", update: "updated", delete: "deleted", invite: "invited", send: "sent", upload: "uploaded", review: "reviewed",
  archive: "archived", export: "exported", import: "imported", print: "printed", open: "opened", view: "viewed", apply: "applied",
};

const capital = (s: string) => s.replace(/^\w/, (c) => c.toUpperCase());

/** "listing.publish" reads "Listing published"; unknown verbs keep their own words. */
export const activityLabel = (action: string | null | undefined): string => {
  const words = (action ?? "").toLowerCase().split(/[._\s]+/).filter(Boolean);
  if (words.length === 0) return "Event";
  const last = words[words.length - 1];
  if (words.length > 1 && PAST_TENSE[last]) return capital([...words.slice(0, -1), PAST_TENSE[last]].join(" "));
  return capital(words.join(" "));
};

/** The record kind in words ("Vehicle listing"), never the internal table name or id. */
export const entityKindLabel = (type: string | null | undefined): string => {
  const t = (type ?? "").replace(/[_.]+/g, " ").trim();
  return t ? capital(t) : "Unknown record";
};
