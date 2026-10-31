import type { Tone } from "../types";
import { readRows, settle } from "./read";

export interface AuditRow {
  id: string;
  at: string;
  /** Display time and actor, e.g. "09:14 / Operator A". */
  timeActor: string;
  scope: string;
  action: string;
  outcome: { label: string; tone?: Tone };
  correlation: string;
}

export interface AuditModel {
  rows: AuditRow[];
  rowsNote: string;
  footnote: string;
  /** Sources that could not be read: their rows are missing, not absent. */
  unreadable: string[];
}

interface NetworkAuditRow { id: number; at: string; actor: string | null; store_id: string | null; entity: string; entity_id: string | null; action: string }
interface PlatformAuditRow { id: string; action: string; entity_type: string; entity_id: string; store_id: string | null; user_email: string | null; details: Record<string, unknown> | null; created_at: string }
interface StoreRow { id: string; display_name: string }

const FOOTNOTE = "Append-only operational history. Privileged reads and exports are audited; credentials are excluded.";
const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (iso: string) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** Read-only history from inventory_network_audit and the platform audit_log. Actors without an email stay unresolved. */
export async function loadAudit(): Promise<AuditModel> {
  const [network, platform, stores] = await Promise.all([
    settle(readRows<NetworkAuditRow>("inventory_network_audit", "id,at,actor,store_id,entity,entity_id,action", { order: "at", limit: 50 })),
    settle(readRows<PlatformAuditRow>("audit_log", "id,action,entity_type,entity_id,store_id,user_email,details,created_at", { order: "created_at", limit: 50 })),
    settle(readRows<StoreRow>("dealer_stores", "id,display_name", { limit: 1000 })),
  ]);
  const names = new Map((stores.ok ? stores.value : []).map((s) => [s.id, s.display_name]));
  const scopeOf = (id: string | null) => (id ? names.get(id) ?? "Unresolved store" : "Platform");

  const rows: AuditRow[] = [];
  for (const r of network.ok ? network.value : []) {
    rows.push({ id: `n-${r.id}`, at: r.at, timeActor: `${hhmm(r.at)} / Unresolved actor`, scope: scopeOf(r.store_id), action: `${r.entity} ${r.action}`, outcome: { label: "Recorded; no reason field" }, correlation: r.entity_id ?? "None" });
  }
  for (const r of platform.ok ? platform.value : []) {
    const reason = typeof r.details?.reason === "string" ? r.details.reason : null;
    rows.push({ id: `p-${r.id}`, at: r.created_at, timeActor: `${hhmm(r.created_at)} / ${r.user_email ?? "Unresolved actor"}`, scope: scopeOf(r.store_id), action: r.action, outcome: { label: reason ?? "No reason recorded" }, correlation: `${r.entity_type}:${r.entity_id}` });
  }
  rows.sort((a, b) => b.at.localeCompare(a.at));

  const unreadable = [!network.ok && "inventory_network_audit", !platform.ok && "audit_log"].filter((x): x is string => !!x);
  return {
    rows: rows.slice(0, 50),
    rowsNote: unreadable.length === 2 ? "Audit history is not readable, so who changed what is unknown." : "No audit events are recorded for these sources.",
    footnote: FOOTNOTE,
    unreadable,
  };
}
