// The Budgets & alerts panel's form rules, kept out of the component so they
// can be tested. The database (proposed migration 20261103000000) enforces the
// same rules; these exist so an admin sees the problem before saving.

export type BudgetMode = "off" | "alert_only" | "enforce";

export const BUDGET_PROVIDERS: { id: string; label: string }[] = [
  { id: "*", label: "All providers combined" },
  { id: "marketcheck", label: "MarketCheck" },
  { id: "firecrawl", label: "Firecrawl (page renders, OEM searches)" },
  { id: "vinaudit", label: "VinAudit window stickers" },
  { id: "monroneylabels", label: "MonroneyLabels window stickers" },
  { id: "blackbook", label: "Black Book values" },
];

export const MODE_LABEL: Record<BudgetMode, string> = {
  off: "Off",
  alert_only: "Alert only",
  enforce: "Enforce",
};

export const providerLabel = (id: string): string =>
  BUDGET_PROVIDERS.find((p) => p.id === id)?.label ?? id;

const split = (raw: string): string[] => raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);

export function parseEmails(raw: string): { ok: string[]; invalid: string[] } {
  const ok: string[] = [];
  const invalid: string[] = [];
  for (const e of split(raw)) {
    const v = e.toLowerCase();
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { if (!ok.includes(v)) ok.push(v); } else invalid.push(e);
  }
  return { ok, invalid };
}

// Text message recipients in E.164. A bare 10-digit US number, with or without
// punctuation, is accepted and given its +1.
export function parsePhones(raw: string): { ok: string[]; invalid: string[] } {
  const ok: string[] = [];
  const invalid: string[] = [];
  for (const chunk of raw.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)) {
    const digits = chunk.replace(/[^\d+]/g, "");
    let v: string | null = null;
    if (/^\+[1-9]\d{7,14}$/.test(digits)) v = digits;
    else if (/^\d{10}$/.test(digits)) v = `+1${digits}`;
    else if (/^1\d{10}$/.test(digits)) v = `+${digits}`;
    if (v) { if (!ok.includes(v)) ok.push(v); } else invalid.push(chunk);
  }
  return { ok, invalid };
}

export function parseThresholds(raw: string): { ok: number[]; error: string | null } {
  const parts = split(raw.replace(/%/g, ""));
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isInteger(n) || n < 1 || n > 200)) {
    return { ok: [], error: "Alert points are whole percentages from 1 to 200." };
  }
  const ok = [...new Set(nums)].sort((a, b) => a - b);
  if (ok.length > 5) return { ok: [], error: "At most five alert points." };
  return { ok, error: null };
}

export interface BudgetForm {
  tenantId: string;
  provider: string;
  mode: BudgetMode;
  callCap: string;
  usdCap: string;
  thresholds: string;
  blockEssential: boolean;
  notes: string;
}

export interface BudgetPayload {
  p_tenant_id: string;
  p_provider: string;
  p_mode: BudgetMode;
  p_monthly_call_cap: number | null;
  p_monthly_usd_cap: number | null;
  p_alert_thresholds: number[];
  p_block_essential: boolean;
  p_notes: string | null;
}

export function budgetPayload(f: BudgetForm): { payload: BudgetPayload | null; error: string | null } {
  if (!f.tenantId) return { payload: null, error: "Choose a dealership." };
  if (!BUDGET_PROVIDERS.some((p) => p.id === f.provider)) return { payload: null, error: "Choose a provider." };
  const callCap = f.callCap.trim() === "" ? null : Number(f.callCap);
  const usdCap = f.usdCap.trim() === "" ? null : Number(f.usdCap.replace(/[$,]/g, ""));
  if (callCap != null && (!Number.isInteger(callCap) || callCap < 0)) return { payload: null, error: "The call limit is a whole number of calls." };
  if (usdCap != null && (!Number.isFinite(usdCap) || usdCap < 0)) return { payload: null, error: "The dollar limit is an amount such as 250 or 250.00." };
  if (f.mode !== "off" && callCap == null && usdCap == null) return { payload: null, error: "Set a call limit, a dollar limit, or both." };
  const t = parseThresholds(f.thresholds);
  if (t.error) return { payload: null, error: t.error };
  return {
    payload: {
      p_tenant_id: f.tenantId,
      p_provider: f.provider,
      p_mode: f.mode,
      p_monthly_call_cap: callCap,
      p_monthly_usd_cap: usdCap == null ? null : Math.round(usdCap * 100) / 100,
      p_alert_thresholds: t.ok,
      p_block_essential: f.blockEssential,
      p_notes: f.notes.trim() || null,
    },
    error: null,
  };
}

// The larger of calls used against the call limit and dollars used against
// the dollar limit; null when no limit is set.
export function percentUsed(calls: number, usd: number, callCap: number | null, usdCap: number | null): number | null {
  const parts: number[] = [];
  if (callCap != null) parts.push(callCap === 0 ? 100 : (100 * calls) / callCap);
  if (usdCap != null) parts.push(usdCap === 0 ? 100 : (100 * usd) / usdCap);
  return parts.length ? Math.max(...parts) : null;
}

// PostgREST's answers when the proposed migration has not been applied: an
// unknown function (PGRST202), an unknown table (42P01 / PGRST205).
export function isMissingSchema(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (["PGRST202", "PGRST205", "42P01", "42883"].includes(String(err.code))) return true;
  return /does not exist|could not find the (function|table)/i.test(err.message || "");
}

export const CHANNEL_STATUS_LABEL: Record<string, string> = {
  sent: "Sent",
  failed: "Failed",
  disabled: "Off",
  no_recipients: "No recipients",
};
