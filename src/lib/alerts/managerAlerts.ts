// ── Manager alerts (in-app) ─────────────────────────────────────────────────
// Turns the raw customer-engagement clickstream into a short, governed list of
// shoppers a salesperson should follow up with NOW. Two hard rules:
//   1. An alert states what the shopper DID (facts, most-recent first) — it never
//      predicts a purchase or assigns a buy "probability". "Tapped call · returned
//      twice" is evidence; "likely to buy" is not something this data supports.
//   2. An alert only fires on a real intent action (reached out, reserved, asked
//      about financing/trade, looked up directions). Passive views never alert.
// Acknowledgement is session-local for now (localStorage); it silences an alert
// until NEW activity arrives, at which point it re-surfaces.

export interface AlertEventRow {
  visitor_id?: string | null;
  session_id?: string | null;
  event_type?: string | null;
  vin?: string | null;
  stock?: string | null;
  vehicle_id?: string | null;
  created_at?: string | null;
  metadata?: Record<string, unknown> | null;
}

export type AlertSeverity = "hot" | "warm";

export interface AlertSignal {
  type: string;
  label: string;      // human, dealer-facing fact
  at: string;         // ISO
  weight: number;
  strong: boolean;
}

export interface ManagerAlert {
  key: string;                 // visitorId::vehicleKey — stable per shopper+vehicle
  visitorId: string;
  vehicle: { vehicleId: string | null; vin: string | null; stock: string | null; label: string };
  severity: AlertSeverity;
  score: number;
  signals: AlertSignal[];      // deduped by type, most-recent first
  sessions: number;
  firstSeenAt: string;
  lastActivityAt: string;
  suggestedAction: string;     // governed next step, never presumptuous
}

// Weight + label + strength for each intent event. A "strong" signal is a direct
// outreach or commitment; medium signals are meaningful but softer. cta_clicked
// is resolved by its metadata action. Anything not listed is not an intent event
// and never contributes to an alert.
const STRONG = true;
const SIGNAL: Record<string, { label: string; weight: number; strong: boolean }> = {
  customer_passport_reserve_clicked: { label: "Reserve request", weight: 12, strong: STRONG },
  lead_submitted:                    { label: "Submitted a request", weight: 12, strong: STRONG },
  call_clicked:                      { label: "Tapped to call", weight: 10, strong: STRONG },
  text_clicked:                      { label: "Tapped to text", weight: 10, strong: STRONG },
  customer_passport_call_clicked:    { label: "Tapped to call", weight: 10, strong: STRONG },
  customer_passport_contact_clicked: { label: "Opened contact", weight: 5, strong: false },
  finance_clicked:                   { label: "Asked about financing", weight: 6, strong: false },
  trade_clicked:                     { label: "Started a trade-in", weight: 6, strong: false },
  customer_passport_trade_clicked:   { label: "Started a trade-in", weight: 6, strong: false },
  directions_clicked:                { label: "Looked up directions", weight: 6, strong: false },
  lead_form_opened:                  { label: "Opened the request form", weight: 4, strong: false },
  packet_opened:                     { label: "Requested the document packet", weight: 4, strong: false },
  document_downloaded:               { label: "Downloaded documents", weight: 3, strong: false },
};

// cta_clicked carries its intent in metadata; only commitment-grade actions count.
const CTA_ACTION_SIGNAL: Record<string, { label: string; weight: number; strong: boolean }> = {
  reserve: { label: "Reserve request", weight: 12, strong: STRONG },
  dealer_profile: { label: "Opened the dealership page", weight: 3, strong: false },
  finance: { label: "Asked about financing", weight: 6, strong: false },
  trade: { label: "Started a trade-in", weight: 6, strong: false },
};

function resolveSignal(row: AlertEventRow): { type: string; label: string; weight: number; strong: boolean } | null {
  const t = row.event_type || "";
  if (t === "cta_clicked") {
    const action = row.metadata?.cta_action ?? row.metadata?.action ?? row.metadata?.cta;
    const s = typeof action === "string" ? CTA_ACTION_SIGNAL[action] : undefined;
    return s ? { type: `cta:${action}`, ...s } : null;
  }
  const s = SIGNAL[t];
  return s ? { type: t, ...s } : null;
}

const vehicleKey = (r: AlertEventRow) => r.vehicle_id || r.vin || r.stock || "unknown";
const vehicleLabel = (r: AlertEventRow) =>
  r.stock ? `Stock ${r.stock}` : r.vin ? `VIN ${r.vin}` : r.vehicle_id ? "Vehicle" : "Vehicle";

function laterIso(a: string, b: string): string { return a >= b ? a : b; }

export interface DeriveOptions {
  /** Minimum composite score to surface a WARM alert. Default 8. */
  warmThreshold?: number;
  /** Score at/above which an alert is HOT (also forced hot by a reserve/lead or 2+ strong signals). Default 16. */
  hotThreshold?: number;
  /** Cap on alerts returned. Default 50. */
  limit?: number;
}

function suggestedAction(signalsByType: Set<string>, severity: AlertSeverity): string {
  const has = (t: string) => signalsByType.has(t);
  if (has("call_clicked") || has("text_clicked") || has("customer_passport_call_clicked"))
    return "They tried to reach you — call or text back";
  if (has("customer_passport_reserve_clicked") || has("cta:reserve") || has("lead_submitted"))
    return "Follow up on their request";
  if (has("finance_clicked") || has("cta:finance"))
    return "They asked about financing — send options";
  if (has("trade_clicked") || has("customer_passport_trade_clicked") || has("cta:trade"))
    return "They started a trade-in — send an estimate";
  if (has("directions_clicked"))
    return "They looked up directions — confirm hours and availability";
  return severity === "hot" ? "Reach out now while they're engaged" : "Reach out while they're engaged";
}

/**
 * Derive governed manager alerts from raw engagement rows. Pure + deterministic
 * (no clock access — recency comes from the event timestamps). Groups by
 * shopper (visitor) + vehicle, scores the intent signals, and emits an alert
 * only when the shopper crossed the warm threshold with at least one real
 * intent action.
 */
export function deriveManagerAlerts(rows: AlertEventRow[], opts: DeriveOptions = {}): ManagerAlert[] {
  const warmThreshold = opts.warmThreshold ?? 8;
  const hotThreshold = opts.hotThreshold ?? 16;
  const limit = opts.limit ?? 50;

  type Group = {
    visitorId: string;
    vehicle: ManagerAlert["vehicle"];
    sessions: Set<string>;
    firstSeenAt: string;
    lastActivityAt: string;
    // best (highest-weight, most-recent) signal per type
    byType: Map<string, AlertSignal>;
  };
  const groups = new Map<string, Group>();

  for (const row of rows) {
    const visitor = (row.visitor_id || "").trim();
    if (!visitor) continue;
    const sig = resolveSignal(row);
    const at = row.created_at || "";
    const gkey = `${visitor}::${vehicleKey(row)}`;
    let g = groups.get(gkey);
    if (!g) {
      g = {
        visitorId: visitor,
        vehicle: { vehicleId: row.vehicle_id || null, vin: row.vin || null, stock: row.stock || null, label: vehicleLabel(row) },
        sessions: new Set(),
        firstSeenAt: at || "9999",
        lastActivityAt: at || "0000",
        byType: new Map(),
      };
      groups.set(gkey, g);
    }
    if (row.session_id) g.sessions.add(row.session_id);
    if (at) { g.firstSeenAt = g.firstSeenAt < at ? g.firstSeenAt : at; g.lastActivityAt = laterIso(g.lastActivityAt, at); }
    if (!sig) continue;
    const existing = g.byType.get(sig.type);
    // keep the most recent occurrence of each signal type
    if (!existing || at > existing.at) {
      g.byType.set(sig.type, { type: sig.type, label: sig.label, at: at || existing?.at || "", weight: sig.weight, strong: sig.strong });
    }
  }

  const alerts: ManagerAlert[] = [];
  for (const [gkey, g] of groups) {
    const signals = [...g.byType.values()];
    if (!signals.length) continue; // no intent action → never alert on passive views

    const strongCount = signals.filter((s) => s.strong).length;
    const base = signals.reduce((s, x) => s + x.weight, 0);
    const repeatBonus = Math.min(8, Math.max(0, g.sessions.size - 1) * 4);
    const score = base + repeatBonus;

    if (score < warmThreshold) continue;

    const forcedHot = signals.some((s) => s.type === "customer_passport_reserve_clicked" || s.type === "cta:reserve" || s.type === "lead_submitted") || strongCount >= 2;
    const severity: AlertSeverity = forcedHot || score >= hotThreshold ? "hot" : "warm";

    const ordered = signals.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.weight - a.weight));
    alerts.push({
      key: gkey,
      visitorId: g.visitorId,
      vehicle: g.vehicle,
      severity,
      score,
      signals: ordered,
      sessions: g.sessions.size,
      firstSeenAt: g.firstSeenAt,
      lastActivityAt: g.lastActivityAt,
      suggestedAction: suggestedAction(new Set(signals.map((s) => s.type)), severity),
    });
  }

  // Hottest first, then most-recent activity.
  const rank = { hot: 0, warm: 1 } as const;
  alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : b.score - a.score));
  return alerts.slice(0, limit);
}

// ── Acknowledgement (session-local v1) ──────────────────────────────────────
// Persisted-per-user acknowledgement needs a table; for now a manager's dismiss
// is stored on-device and silences the alert until NEW activity arrives (its
// lastActivityAt moves past the acknowledged timestamp).

const ACK_KEY = "al_manager_alert_acks_v1";

type AckMap = Record<string, string>; // alert.key -> acknowledged lastActivityAt

function readAcks(): AckMap {
  if (typeof localStorage === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(ACK_KEY) || "{}") as AckMap; } catch { return {}; }
}

export function acknowledgeAlert(alert: Pick<ManagerAlert, "key" | "lastActivityAt">): void {
  if (typeof localStorage === "undefined") return;
  try {
    const acks = readAcks();
    acks[alert.key] = alert.lastActivityAt;
    localStorage.setItem(ACK_KEY, JSON.stringify(acks));
  } catch { /* private mode — ack simply won't persist */ }
}

/** Drop alerts that were acknowledged and have had no newer activity since. */
export function filterAcknowledged(alerts: ManagerAlert[], acks: AckMap = readAcks()): ManagerAlert[] {
  return alerts.filter((a) => !acks[a.key] || a.lastActivityAt > acks[a.key]);
}

export function getAcknowledgements(): AckMap { return readAcks(); }
