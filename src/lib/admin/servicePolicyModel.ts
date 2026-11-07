import type { DealerSettings } from "@/contexts/DealerSettingsContext";
import { roleLabelFor, type ServicePolicy } from "@/lib/admin/documentPolicy";

// Read models for the Service policy screen. They only describe values that
// already exist in dealer_profiles.settings and how the existing workflows
// read them; no key, default or enforcement rule is added here.

export type SignerMode = "any" | "selected";

export const signerModeFor = (roles: readonly string[]): SignerMode => (roles.length > 0 ? "selected" : "any");

/** An empty selection must never be saved as "everyone": it is an error until a role is picked or Any is chosen. */
export function signerSelectionError(required: boolean, mode: SignerMode, roles: readonly string[]): string | null {
  if (!required || mode !== "selected" || roles.length > 0) return null;
  return "Choose at least one authorized role, or switch to Any accepted signer.";
}

export const parseList = (raw: string | null | undefined): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw ?? "").split(/[,;\n]/)) {
    const v = part.trim();
    const k = v.toLowerCase();
    if (v && !seen.has(k)) {
      seen.add(k);
      out.push(v);
    }
  }
  return out;
};

export const joinList = (items: readonly string[]): string => items.join(", ");

export const isEmail = (v: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/** Rule the recon estimate flow applies: at or under the threshold clears; a threshold of 0 routes every line to the manager. */
export function reconRoute(lineAmount: number, threshold: number): "auto" | "manager" {
  if (!(threshold > 0)) return "manager";
  return lineAmount <= threshold ? "auto" : "manager";
}

export const dollars = (n: number): string => `$${Number(n).toLocaleString("en-US")}`;

export interface GroupSummary {
  state: "on" | "off" | "attention";
  headline: string;
  lines: string[];
}

export function inspectionSummary(p: ServicePolicy): GroupSummary {
  if (!p.require_safety_inspection) {
    return { state: "off", headline: "K-208 not required before signing", lines: ["Customer disclosures can be signed without a completed K-208.", p.require_install_verification ? "Install verification is required." : "Install verification is not required."] };
  }
  const roles = p.k208_authority_roles;
  return {
    state: "on",
    headline: "K-208 required on Used and CPO",
    lines: [
      "New vehicles are exempt.",
      roles.length ? `Signers: ${roles.map(roleLabelFor).join(", ")}` : "Signers: any accepted signer",
      p.require_k208_licensee_certification ? "Licensee certification required" : "Technician inspection is enough",
      p.require_install_verification ? "Install verification required" : "Install verification not required",
    ],
  };
}

export function technicianSummary(p: ServicePolicy): GroupSummary {
  const tasks = parseList(p.prep_service_photo_tasks);
  const lines = [p.prep_require_ro ? "RO number required on Service Install" : "RO number not required", p.prep_detail_photos_required ? "Photos required on Initial Inventory Detail" : "Detail photos not required", tasks.length ? `${tasks.length} task${tasks.length === 1 ? "" : "s"} need photo proof` : "No tasks need photo proof"];
  return { state: p.prep_require_ro || p.prep_detail_photos_required || tasks.length ? "on" : "off", headline: "Work-event sign-off rules", lines };
}

export function reconSummary(p: ServicePolicy): GroupSummary {
  const every = !(p.recon_auto_approve_amount > 0);
  const approvers = parseList(p.recon_approval_email);
  return {
    state: approvers.length ? "on" : "attention",
    headline: every ? "Every line item needs approval" : `Auto-approve line items up to ${dollars(p.recon_auto_approve_amount)}`,
    lines: ["Judged per line item. No total repair-order limit applies.", approvers.length ? `${approvers.length} approver${approvers.length === 1 ? "" : "s"} named` : "No approver named: the link goes to the dealership main contact email"],
  };
}

export const TITLE_POLICY_KEYS = ["title_clerk_email", "title_email_on_intake", "title_round_robin", "title_reminders_enabled", "title_reminder_days"] as const;
export type TitlePolicyKey = (typeof TITLE_POLICY_KEYS)[number];
export type TitlePolicy = Pick<DealerSettings, TitlePolicyKey>;

export const TITLE_POLICY_LABELS: Readonly<Record<TitlePolicyKey, string>> = {
  title_clerk_email: "Title and MCO recipients",
  title_email_on_intake: "Email the office on intake",
  title_round_robin: "Notify one recipient at a time (rotate)",
  title_reminders_enabled: "Resend reminders until received",
  title_reminder_days: "Remind every (days)",
};

export const titlePolicyFromSettings = (s: Partial<TitlePolicy>): TitlePolicy => ({
  title_clerk_email: s.title_clerk_email ?? "",
  title_email_on_intake: s.title_email_on_intake === true,
  title_round_robin: s.title_round_robin === true,
  title_reminders_enabled: s.title_reminders_enabled === true,
  title_reminder_days: Number.isFinite(s.title_reminder_days) ? (s.title_reminder_days as number) : 3,
});

export const formatTitleValue = (key: TitlePolicyKey, value: unknown): string => {
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (key === "title_reminder_days") return `${value} day${value === 1 ? "" : "s"}`;
  const list = parseList(String(value ?? ""));
  return list.length ? list.join(", ") : "None";
};

export function titlePolicyValidation(t: TitlePolicy): string[] {
  const errors: string[] = [];
  if (parseList(t.title_clerk_email).some((e) => !isEmail(e))) errors.push("Title recipients must be valid email addresses.");
  if (!Number.isFinite(t.title_reminder_days) || t.title_reminder_days < 1 || !Number.isInteger(t.title_reminder_days)) errors.push("The reminder frequency must be a whole number of days, 1 or more.");
  return errors;
}

export function titlePolicyWarnings(before: TitlePolicy, after: TitlePolicy): string[] {
  const out: string[] = [];
  if (before.title_reminders_enabled && !after.title_reminders_enabled) out.push("Reminders stop. A vehicle with no title or MCO on file will not be chased automatically.");
  if (!before.title_reminders_enabled && after.title_reminders_enabled) out.push("The daily sweep will start emailing the office about in-stock vehicles with no complete title or MCO.");
  if (after.title_reminder_days < before.title_reminder_days && after.title_reminders_enabled) out.push("Reminders will go out more often.");
  return out;
}

/** The server caps a notify-everyone send at 3 recipients unless title_recipient_cap is set; the UI never changes that cap. */
export const TITLE_DEFAULT_RECIPIENT_CAP = 3;
/** title-reminders-sweep emails at most this many vehicles per dealership per daily run. */
export const TITLE_SWEEP_VEHICLE_CAP = 60;
/** email-title-request mints a link that expires 365 days after it is created. */
export const TITLE_LINK_DAYS = 365;

export interface TitleCadence {
  recipients: string[];
  routing: string;
  intake: string;
  frequency: string;
  next: string;
  stop: string;
  setupIssue: string | null;
}

export function titleCadence(t: TitlePolicy): TitleCadence {
  const recipients = parseList(t.title_clerk_email);
  const rotating = t.title_round_robin && recipients.length > 1;
  return {
    recipients,
    routing: recipients.length === 0 ? "No recipient named: requests go to the dealership main contact email" : rotating ? "One recipient at a time, rotating on each request" : recipients.length > TITLE_DEFAULT_RECIPIENT_CAP ? `Everyone listed, first ${TITLE_DEFAULT_RECIPIENT_CAP} by default` : "Everyone listed at once",
    intake: t.title_email_on_intake ? "The office is emailed when a vehicle is taken in" : "No email on intake",
    frequency: t.title_reminders_enabled ? `Every ${t.title_reminder_days} day${t.title_reminder_days === 1 ? "" : "s"}` : "Reminders are off",
    next: t.title_reminders_enabled ? `${t.title_reminder_days} day${t.title_reminder_days === 1 ? "" : "s"} after each vehicle's last request email. The sweep runs once a day, so a send can land up to a day later.` : "Not scheduled",
    stop: "A reminder stops when both the front and back images of the Title (used) or MCO (new) are on file, or when the vehicle is no longer in Draft or Published status.",
    setupIssue: recipients.length === 0 ? "No title recipient is set. Requests fall back to the dealership main contact email; add a clerk so the right person is asked." : null,
  };
}

export function titleSummary(t: TitlePolicy): GroupSummary {
  const c = titleCadence(t);
  return {
    state: c.setupIssue ? "attention" : t.title_reminders_enabled || t.title_email_on_intake ? "on" : "off",
    headline: t.title_reminders_enabled ? `Reminders ${c.frequency.toLowerCase()}` : "Reminders off",
    lines: [c.recipients.length ? `${c.recipients.length} recipient${c.recipients.length === 1 ? "" : "s"}: ${c.routing.toLowerCase()}` : "No recipient named", c.intake],
  };
}
