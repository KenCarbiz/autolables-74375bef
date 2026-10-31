import { prepDueState } from "./prepDue";

export type PrepNextActionKey =
  | "complete_inspection"
  | "foreman_sign_off"
  | "resolve_rejection"
  | "unlock_listing"
  | "none";

export interface PrepNextAction {
  key: PrepNextActionKey;
  label: string;
  overdue: boolean;
}

export interface PrepActionInput {
  status: string | null | undefined;
  inspection_passed?: boolean | null;
  listing_unlocked?: boolean | null;
  rejection_reason?: string | null;
}

const LABEL: Record<PrepNextActionKey, string> = {
  complete_inspection: "Complete inspection",
  foreman_sign_off: "Foreman sign-off",
  resolve_rejection: "Resolve rejection",
  unlock_listing: "Unlock listing",
  none: "No action needed",
};

const keyFor = (row: PrepActionInput): PrepNextActionKey => {
  const status = `${row.status ?? ""}`.trim().toLowerCase();
  if (row.listing_unlocked) return "none";
  if (status === "rejected") return "resolve_rejection";
  if (status === "signed" || status === "overridden") return "unlock_listing";
  return row.inspection_passed ? "foreman_sign_off" : "complete_inspection";
};

export function derivePrepNextAction(
  row: PrepActionInput,
  opts: { dueAt?: string | null; now?: number } = {},
): PrepNextAction {
  const key = keyFor(row);
  const overdue = key !== "none" && prepDueState(opts.dueAt ?? null, opts.now ?? Date.now()) === "overdue";
  const reason = row.rejection_reason?.trim();
  const label = key === "resolve_rejection" && reason ? `${LABEL[key]}: ${reason}` : LABEL[key];
  return { key, label, overdue };
}
