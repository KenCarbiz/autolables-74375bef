import { deriveManagerAlerts, type AlertEventRow, type ManagerAlert } from "@/lib/alerts/managerAlerts";
import { eventLabel, moduleLabel } from "@/lib/shopperActivity";

// ──────────────────────────────────────────────────────────────────────
// customerBook — pure assembly of the Customers + Deals surfaces from the
// rows that actually exist in this database.
//
// HONESTY RULES (the whole point of this module):
//   1. Engagement is keyed on visitor_id. The ONLY proven bridge from a
//      visitor to a person is passport_document_delivery_requests, which
//      stores customer_email/customer_name alongside the same visitor_id
//      and session_id the tracker writes. A lead row carries no visitor
//      link at all, so a lead's name is NEVER attached to anonymous
//      engagement — that shopper stays "Unidentified shopper".
//   2. No scores, probabilities or ratings are exposed. Bucketing reuses
//      the governed manager-alert engine (a real intent action is
//      required; passive views never promote a shopper).
//   3. Every rollup ships the next action it implies. A number with no
//      action does not belong on these screens.
// ──────────────────────────────────────────────────────────────────────

export type CustomerBucket = "hot" | "follow_up" | "working" | "won" | "lost";
export type DealState = "draft" | "out_for_signature" | "signed" | "delivered";
export type PriceIntegrity = "verified" | "mismatch" | "unverified" | "untracked";

export const IN_FLIGHT_LIFECYCLE = ["ready_for_signature", "awaiting_customer", "customer_opened", "partially_signed"];

export const BUCKET_LABEL: Record<CustomerBucket, string> = {
  hot: "Hot",
  follow_up: "Follow up",
  working: "Working",
  won: "Won",
  lost: "Lost",
};

export const BUCKET_EMPTY_COPY: Record<CustomerBucket, string> = {
  hot: "No customers currently meet this engagement filter. A shopper lands here after a real intent action - a hold request, a call or text tap, a trade or financing request - not after passive views.",
  follow_up: "No customers are waiting on a first response.",
  working: "No customers are being worked right now.",
  won: "No customers have a converted lead or a delivered deal yet.",
  lost: "No customers have been marked lost.",
};

export interface LeadRow {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  vehicle_interest: string | null;
  vehicle_vin: string | null;
  source: string | null;
  sub_source: string | null;
  status: string | null;
  notes: string | null;
  captured_at: string;
  first_response_at: string | null;
  escalated_at: string | null;
  escalation_level: number | null;
  routed_agent_id: string | null;
}

export interface EngagementRow {
  session_id: string | null;
  visitor_id: string | null;
  vin: string | null;
  stock: string | null;
  vehicle_id: string | null;
  event_type: string | null;
  document_type: string | null;
  source: string | null;
  device_type: string | null;
  city: string | null;
  region: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  occurred_at: string | null;
}

export interface DwellRow {
  session_id: string | null;
  vin: string | null;
  module: string | null;
  seconds: number | null;
  last_at: string | null;
}

export interface DocumentRequestRow {
  id: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  vin: string | null;
  stock: string | null;
  vehicle_id: string | null;
  visitor_id: string | null;
  session_id: string | null;
  requested_documents: unknown;
  delivery_status: string | null;
  verification_status: string | null;
  requested_at: string;
  delivered_at: string | null;
}

export interface DealRow {
  id: string;
  customer_name: string | null;
  customer_email: string | null;
  vehicle_vin: string | null;
  vehicle_ymm: string | null;
  vehicle_stock: string | null;
  selling_price: number | null;
  total_with_optional: number | null;
  status: string | null;
  lifecycle_status: string | null;
  price_verification_status: string | null;
  price_verification_delta: number | null;
  accepted_at: string | null;
  customer_signed_at: string | null;
  employee_signed_at: string | null;
  delivered_at: string | null;
  employee_name: string | null;
  signing_token: string | null;
  ready_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SigningRow {
  id: string;
  addendum_id: string | null;
  vin: string | null;
  signer_type: string | null;
  signer_name: string | null;
  signed_at: string | null;
  return_status: string | null;
  return_window_closes_at: string | null;
  return_requested_at: string | null;
  return_completed_at: string | null;
  return_reason: string | null;
}

export interface ListingRow {
  id: string;
  vin: string | null;
  ymm: string | null;
  slug: string | null;
  stock_number: string | null;
}

export interface AgentRow {
  id: string;
  name: string;
}

export interface EngagementFact {
  key: string;
  label: string;
  count: number;
  lastAt: string;
  action: string;
}

export interface EngagementRollup {
  linked: boolean;
  sessions: number;
  visitDays: number;
  dwellSeconds: number;
  modules: { module: string; label: string; seconds: number }[];
  facts: EngagementFact[];
  firstAt: string | null;
  lastAt: string | null;
}

export interface VehicleOfInterest {
  vin: string | null;
  label: string;
  stock: string | null;
  listingId: string | null;
  slug: string | null;
  sources: string[];
}

export type NextActionKind = "call" | "email" | "signature" | "delivery" | "return" | "price" | "vehicle" | "none";

export interface NextAction {
  headline: string;
  detail: string;
  kind: NextActionKind;
}

export interface ReturnInfo {
  status: string;
  label: string;
  closesAt: string | null;
  requestedAt: string | null;
  completedAt: string | null;
  reason: string | null;
}

export interface DealEntry {
  id: string;
  createdAt: string;
  updatedAt: string;
  vehicleLabel: string;
  vin: string | null;
  stock: string | null;
  listingId: string | null;
  slug: string | null;
  customerName: string | null;
  customerId: string | null;
  amount: number | null;
  state: DealState;
  stateLabel: string;
  stateDetail: string;
  priceIntegrity: { state: PriceIntegrity; label: string; delta: number | null };
  employeeName: string | null;
  signingToken: string | null;
  signedAt: string | null;
  deliveredAt: string | null;
  returnInfo: ReturnInfo | null;
  nextAction: NextAction;
}

export interface ActivityItem {
  at: string;
  label: string;
  detail: string;
  kind: "lead" | "engagement" | "document" | "deal" | "signature" | "return";
}

export interface CustomerEntry {
  id: string;
  identified: boolean;
  name: string | null;
  email: string | null;
  phone: string | null;
  bucket: CustomerBucket;
  vehicles: VehicleOfInterest[];
  engagement: EngagementRollup;
  returnStatus: { label: string; detail: string };
  assignedEmployee: { name: string; source: string } | null;
  lastActivityAt: string | null;
  nextAction: NextAction;
  leads: LeadRow[];
  deals: DealEntry[];
  documentRequests: DocumentRequestRow[];
  alerts: ManagerAlert[];
  activity: ActivityItem[];
  visitorIds: string[];
}

export interface CustomerBook {
  customers: CustomerEntry[];
  deals: DealEntry[];
  passiveVisitors: number;
  linkedVisitors: number;
}

export interface CustomerBookInput {
  now?: number;
  leads?: LeadRow[] | null;
  events?: EngagementRow[] | null;
  dwell?: DwellRow[] | null;
  documentRequests?: DocumentRequestRow[] | null;
  deals?: DealRow[] | null;
  signings?: SigningRow[] | null;
  listings?: ListingRow[] | null;
  agents?: AgentRow[] | null;
}

const HOT_WINDOW_MS = 7 * 86_400_000;

const norm = (v: string | null | undefined) => (v || "").trim();
const lower = (v: string | null | undefined) => norm(v).toLowerCase();
const upper = (v: string | null | undefined) => norm(v).toUpperCase();

export const identityKey = (email: string | null, name: string | null, vin: string | null): string | null => {
  const e = lower(email);
  if (e) return `e:${e}`;
  const n = lower(name);
  if (n) return `n:${n}|${upper(vin)}`;
  return null;
};

export const relativeTime = (iso: string | null | undefined, now = Date.now()): string => {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "unknown";
  const diff = now - t;
  if (diff < 0) {
    const ahead = Math.abs(diff);
    if (ahead < 3_600_000) return `in ${Math.max(1, Math.round(ahead / 60_000))}m`;
    if (ahead < 86_400_000) return `in ${Math.round(ahead / 3_600_000)}h`;
    return `in ${Math.round(ahead / 86_400_000)}d`;
  }
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  if (diff < 30 * 86_400_000) return `${Math.round(diff / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

export const money = (n: number | null | undefined): string =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })
    : "--";

export const dwellLabel = (seconds: number): string => {
  if (seconds <= 0) return "no measured reading time";
  if (seconds < 60) return `${Math.round(seconds)}s reading`;
  return `${Math.floor(seconds / 60)}m ${String(Math.round(seconds % 60)).padStart(2, "0")}s reading`;
};

const eventAt = (e: EngagementRow) => e.created_at || e.occurred_at || "";
const metaString = (m: Record<string, unknown> | null | undefined, k: string): string =>
  typeof m?.[k] === "string" ? (m[k] as string) : "";

// One clickstream row -> the fact it proves. cta_clicked and lead_form_opened
// carry their real meaning in metadata, so the raw event_type alone would
// under-report the payment and test-drive tools.
export const factKey = (e: EngagementRow): string | null => {
  const type = norm(e.event_type);
  if (!type) return null;
  if (type === "engagement_ping" || type === "scroll_depth" || type === "time_on_page" || type === "customer_passport_closed") return null;
  const ev = metaString(e.metadata, "event");
  if (ev.startsWith("todays_price")) return "tool:payment";
  if (ev.startsWith("test_drive")) return "tool:test_drive";
  if (type === "cta_clicked") {
    const action = metaString(e.metadata, "cta_action") || metaString(e.metadata, "action") || metaString(e.metadata, "cta");
    return action ? `cta:${action}` : "cta:other";
  }
  if (type === "document_opened" || type === "document_downloaded") {
    const doc = lower(e.document_type);
    if (doc.includes("window_sticker")) return "doc:window_sticker";
  }
  return type;
};

const FACT_LABEL: Record<string, string> = {
  "tool:payment": "Used the payment tool",
  "tool:test_drive": "Used the test-drive request",
  "cta:reserve": "Tapped Request Hold",
  "cta:trade": "Tapped Value My Trade",
  "cta:payment": "Tapped Payment",
  "cta:contact": "Tapped Contact",
  "cta:test-drive": "Tapped Test Drive",
  "cta:availability": "Tapped Check Availability",
  "cta:finance": "Tapped Financing",
  "cta:dealer_profile": "Opened the dealership page",
  "cta:other": "Tapped a passport action",
  "doc:window_sticker": "Viewed the window sticker",
};

const FACT_ACTION: Record<string, string> = {
  "tool:payment": "Send the payment breakdown you can actually honor.",
  "tool:test_drive": "Offer two concrete times today.",
  "cta:reserve": "Call now and confirm the hold in writing.",
  "cta:trade": "Send a trade estimate or book the appraisal.",
  "cta:payment": "Send the payment breakdown you can actually honor.",
  "cta:contact": "They opened contact - answer before they call someone else.",
  "cta:test-drive": "Offer two concrete times today.",
  "cta:availability": "Confirm the vehicle is still on the lot.",
  "cta:finance": "Send financing options.",
  "cta:dealer_profile": "They vetted the store - lead with your reviews.",
  "cta:other": "Open the record and read what they tapped.",
  "doc:window_sticker": "Offer the full document packet.",
  customer_passport_reserve_clicked: "Call now and confirm the hold in writing.",
  customer_passport_trade_clicked: "Send a trade estimate or book the appraisal.",
  customer_passport_call_clicked: "They tried to call - call back.",
  customer_passport_contact_clicked: "They opened contact - answer first.",
  call_clicked: "They tried to call - call back.",
  text_clicked: "They tried to text - text back.",
  directions_clicked: "Confirm hours and that the car is on the lot.",
  finance_clicked: "Send financing options.",
  trade_clicked: "Send a trade estimate or book the appraisal.",
  lead_submitted: "Answer the request they already sent.",
  lead_form_opened: "They started a form and stopped - reach out.",
  packet_opened: "Ask which document they still need.",
  document_opened: "Ask which document they still need.",
  document_downloaded: "They kept your documents - follow up on the details.",
  window_sticker_scanned: "They scanned the sticker on the lot - be on the lot.",
  passport_opened: "Keep the passport link in front of them.",
  customer_passport_opened: "Keep the passport link in front of them.",
  photo_viewed: "Send more photos or a walkaround.",
};

export const factLabel = (key: string): string => FACT_LABEL[key] || eventLabel(key);
export const factAction = (key: string): string => FACT_ACTION[key] || "Open the record for the full activity trail.";

interface VisitorRollup {
  visitorId: string;
  sessions: Set<string>;
  days: Set<string>;
  vins: Set<string>;
  facts: Map<string, { count: number; lastAt: string }>;
  firstAt: string | null;
  lastAt: string | null;
}

const buildVisitorRollups = (events: EngagementRow[]): Map<string, VisitorRollup> => {
  const map = new Map<string, VisitorRollup>();
  for (const e of events) {
    const visitor = norm(e.visitor_id);
    if (!visitor) continue;
    const at = eventAt(e);
    let r = map.get(visitor);
    if (!r) {
      r = { visitorId: visitor, sessions: new Set(), days: new Set(), vins: new Set(), facts: new Map(), firstAt: null, lastAt: null };
      map.set(visitor, r);
    }
    if (e.session_id) r.sessions.add(e.session_id);
    if (e.vin) r.vins.add(upper(e.vin));
    if (at) {
      r.days.add(at.slice(0, 10));
      if (!r.firstAt || at < r.firstAt) r.firstAt = at;
      if (!r.lastAt || at > r.lastAt) r.lastAt = at;
    }
    const key = factKey(e);
    if (!key) continue;
    const prev = r.facts.get(key);
    r.facts.set(key, { count: (prev?.count || 0) + 1, lastAt: prev && prev.lastAt > at ? prev.lastAt : at });
  }
  return map;
};

const emptyEngagement = (): EngagementRollup => ({
  linked: false,
  sessions: 0,
  visitDays: 0,
  dwellSeconds: 0,
  modules: [],
  facts: [],
  firstAt: null,
  lastAt: null,
});

const mergeRollups = (
  rollups: VisitorRollup[],
  dwell: DwellRow[],
  vinFilter: string | null,
): EngagementRollup => {
  if (!rollups.length) return emptyEngagement();
  const sessions = new Set<string>();
  const days = new Set<string>();
  const facts = new Map<string, { count: number; lastAt: string }>();
  let firstAt: string | null = null;
  let lastAt: string | null = null;
  for (const r of rollups) {
    r.sessions.forEach((s) => sessions.add(s));
    r.days.forEach((d) => days.add(d));
    for (const [k, v] of r.facts) {
      const prev = facts.get(k);
      facts.set(k, { count: (prev?.count || 0) + v.count, lastAt: prev && prev.lastAt > v.lastAt ? prev.lastAt : v.lastAt });
    }
    if (r.firstAt && (!firstAt || r.firstAt < firstAt)) firstAt = r.firstAt;
    if (r.lastAt && (!lastAt || r.lastAt > lastAt)) lastAt = r.lastAt;
  }
  const moduleSeconds = new Map<string, number>();
  let dwellSeconds = 0;
  for (const d of dwell) {
    if (!d.session_id || !sessions.has(d.session_id)) continue;
    if (vinFilter && d.vin && upper(d.vin) !== vinFilter) continue;
    const secs = Math.max(0, Number(d.seconds) || 0);
    dwellSeconds += secs;
    const key = norm(d.module) || "unknown";
    moduleSeconds.set(key, (moduleSeconds.get(key) || 0) + secs);
  }
  return {
    linked: true,
    sessions: sessions.size,
    visitDays: days.size,
    dwellSeconds,
    modules: [...moduleSeconds.entries()]
      .map(([module, seconds]) => ({ module, label: moduleLabel(module), seconds }))
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 6),
    facts: [...facts.entries()]
      .map(([key, v]) => ({ key, label: factLabel(key), count: v.count, lastAt: v.lastAt, action: factAction(key) }))
      .sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0)),
    firstAt,
    lastAt,
  };
};

const RETURN_LABEL: Record<string, string> = {
  eligible: "Return window open",
  requested: "Return requested",
  completed: "Return completed",
  denied: "Return denied",
  expired: "Return window closed",
  waived: "Return right waived",
};

const buildReturnInfo = (signings: SigningRow[], now: number): ReturnInfo | null => {
  const row = signings.find((s) => s.return_status || s.return_window_closes_at);
  if (!row) return null;
  const status = norm(row.return_status) || "eligible";
  const closes = row.return_window_closes_at;
  const open = status === "eligible" && !!closes && new Date(closes).getTime() > now;
  return {
    status,
    label: open ? `Return window closes ${relativeTime(closes, now)}` : RETURN_LABEL[status] || "Return tracked",
    closesAt: closes,
    requestedAt: row.return_requested_at,
    completedAt: row.return_completed_at,
    reason: row.return_reason,
  };
};

const priceIntegrityOf = (deal: DealRow): DealEntry["priceIntegrity"] => {
  const status = norm(deal.price_verification_status);
  const delta = typeof deal.price_verification_delta === "number" ? deal.price_verification_delta : null;
  if (status === "verified") return { state: "verified", label: "Price verified", delta };
  if (status === "mismatch") return { state: "mismatch", label: "Price mismatch", delta };
  if (status === "untracked") return { state: "untracked", label: "Price untracked", delta };
  return { state: "unverified", label: "Price unverified", delta };
};

const dealStateOf = (deal: DealRow): { state: DealState; label: string; detail: string } => {
  const lifecycle = norm(deal.lifecycle_status);
  if (deal.delivered_at) return { state: "delivered", label: "Delivered", detail: `Delivered ${relativeTime(deal.delivered_at)}` };
  if (lifecycle === "fully_executed" || norm(deal.status) === "signed" || norm(deal.status) === "completed") {
    return { state: "signed", label: "Signed", detail: deal.customer_signed_at ? `Customer signed ${relativeTime(deal.customer_signed_at)}` : "Fully executed" };
  }
  if (IN_FLIGHT_LIFECYCLE.includes(lifecycle)) {
    const label = lifecycle === "partially_signed" ? "Partially signed" : lifecycle === "customer_opened" ? "Customer opened" : "Out for signature";
    return { state: "out_for_signature", label, detail: deal.ready_at ? `Ready ${relativeTime(deal.ready_at)}` : "Awaiting signature" };
  }
  return { state: "draft", label: "Draft", detail: `Created ${relativeTime(deal.created_at)}` };
};

const dealNextAction = (deal: DealRow, state: DealState, price: DealEntry["priceIntegrity"], ret: ReturnInfo | null, now: number): NextAction => {
  if (ret?.status === "requested") {
    return { headline: "Answer the return request", detail: `Requested ${relativeTime(ret.requestedAt, now)}${ret.reason ? ` - "${ret.reason}"` : ""}.`, kind: "return" };
  }
  if (ret?.status === "eligible" && ret.closesAt && new Date(ret.closesAt).getTime() > now) {
    return { headline: "Return window still open", detail: `Closes ${relativeTime(ret.closesAt, now)}. Do not resell until it closes.`, kind: "return" };
  }
  if (state === "delivered") return { headline: "Nothing outstanding", detail: "Delivered and filed.", kind: "none" };
  if (state === "signed") return { headline: "Confirm delivery", detail: "Record delivery date and mileage to close this deal.", kind: "delivery" };
  if (state === "out_for_signature") {
    if (!deal.signing_token) return { headline: "No signing link on this deal", detail: "Regenerate the link before chasing the customer.", kind: "signature" };
    if (norm(deal.lifecycle_status) === "partially_signed") return { headline: "Counter-sign the deal", detail: "The customer already signed - the dealer signature is outstanding.", kind: "signature" };
    const since = deal.ready_at || deal.created_at;
    return { headline: "Chase the signature", detail: `Out for signature since ${relativeTime(since, now)}. Resend the link.`, kind: "signature" };
  }
  if (price.state === "mismatch") {
    return { headline: "Fix the price mismatch", detail: `The addendum and the advertised price disagree${price.delta != null ? ` by ${money(Math.abs(price.delta))}` : ""}. Signing is blocked until it clears.`, kind: "price" };
  }
  if (price.state !== "verified") {
    return { headline: "Verify the price", detail: "The advertised price has not been verified against this deal. Signing is blocked until it clears.", kind: "price" };
  }
  return { headline: "Send for signature", detail: "Price verified - lock the deal and send the signing link.", kind: "signature" };
};

const vehicleLabelOf = (ymm: string | null, vin: string | null, stock: string | null): string =>
  norm(ymm) || (stock ? `Stock ${stock}` : vin ? `VIN ${upper(vin).slice(-8)}` : "Vehicle");

interface Draft {
  id: string;
  identified: boolean;
  name: string | null;
  email: string | null;
  phone: string | null;
  leads: LeadRow[];
  documentRequests: DocumentRequestRow[];
  deals: DealEntry[];
  visitorIds: Set<string>;
  vins: Set<string>;
  alerts: ManagerAlert[];
}

export function buildCustomerBook(input: CustomerBookInput): CustomerBook {
  const now = input.now ?? Date.now();
  const leads = input.leads || [];
  const events = input.events || [];
  const dwell = input.dwell || [];
  const documentRequests = input.documentRequests || [];
  const dealRows = input.deals || [];
  const signings = input.signings || [];
  const listings = input.listings || [];
  const agents = input.agents || [];

  const listingByVin = new Map<string, ListingRow>();
  for (const l of listings) if (l.vin) listingByVin.set(upper(l.vin), l);
  const agentName = new Map<string, string>();
  for (const a of agents) if (a.id) agentName.set(a.id, a.name);

  const signingsByAddendum = new Map<string, SigningRow[]>();
  for (const s of signings) {
    if (!s.addendum_id) continue;
    const list = signingsByAddendum.get(s.addendum_id) || [];
    list.push(s);
    signingsByAddendum.set(s.addendum_id, list);
  }

  const deals: DealEntry[] = dealRows.map((d) => {
    const { state, label, detail } = dealStateOf(d);
    const price = priceIntegrityOf(d);
    const ret = buildReturnInfo(signingsByAddendum.get(d.id) || [], now);
    const listing = d.vehicle_vin ? listingByVin.get(upper(d.vehicle_vin)) || null : null;
    return {
      id: d.id,
      createdAt: d.created_at,
      updatedAt: d.updated_at || d.created_at,
      vehicleLabel: vehicleLabelOf(d.vehicle_ymm, d.vehicle_vin, d.vehicle_stock),
      vin: d.vehicle_vin ? upper(d.vehicle_vin) : null,
      stock: norm(d.vehicle_stock) || listing?.stock_number || null,
      listingId: listing?.id || null,
      slug: listing?.slug || (d.vehicle_vin ? upper(d.vehicle_vin) : null),
      customerName: norm(d.customer_name) || null,
      customerId: identityKey(d.customer_email, d.customer_name, d.vehicle_vin),
      amount: typeof d.total_with_optional === "number" ? d.total_with_optional : d.selling_price,
      state,
      stateLabel: label,
      stateDetail: detail,
      priceIntegrity: price,
      employeeName: norm(d.employee_name) || null,
      signingToken: d.signing_token,
      signedAt: d.customer_signed_at,
      deliveredAt: d.delivered_at,
      returnInfo: ret,
      nextAction: dealNextAction(d, state, price, ret, now),
    };
  });

  const drafts = new Map<string, Draft>();
  const ensure = (key: string, seed: Partial<Draft>): Draft => {
    let d = drafts.get(key);
    if (!d) {
      d = {
        id: key,
        identified: true,
        name: null,
        email: null,
        phone: null,
        leads: [],
        documentRequests: [],
        deals: [],
        visitorIds: new Set(),
        vins: new Set(),
        alerts: [],
      };
      drafts.set(key, d);
    }
    d.name = d.name || seed.name || null;
    d.email = d.email || seed.email || null;
    d.phone = d.phone || seed.phone || null;
    return d;
  };

  for (const lead of leads) {
    const key = identityKey(lead.email, lead.name, lead.vehicle_vin);
    if (!key) continue;
    const d = ensure(key, { name: norm(lead.name) || null, email: lower(lead.email) || null, phone: norm(lead.phone) || null });
    d.leads.push(lead);
    if (lead.vehicle_vin) d.vins.add(upper(lead.vehicle_vin));
  }

  // The identity bridge: a document request carries BOTH the shopper's contact
  // details and the visitor_id the clickstream is keyed on.
  for (const req of documentRequests) {
    const key = identityKey(req.customer_email, req.customer_name, req.vin);
    if (!key) continue;
    const d = ensure(key, { name: norm(req.customer_name) || null, email: lower(req.customer_email) || null, phone: norm(req.customer_phone) || null });
    d.documentRequests.push(req);
    if (req.visitor_id) d.visitorIds.add(req.visitor_id);
    if (req.vin) d.vins.add(upper(req.vin));
  }

  for (const deal of deals) {
    if (!deal.customerId) continue;
    const d = ensure(deal.customerId, { name: deal.customerName });
    d.deals.push(deal);
    if (deal.vin) d.vins.add(deal.vin);
  }

  const visitorRollups = buildVisitorRollups(events);
  const linkedVisitorIds = new Set<string>();
  for (const d of drafts.values()) d.visitorIds.forEach((v) => linkedVisitorIds.add(v));

  const alertRows: AlertEventRow[] = events.map((e) => ({
    visitor_id: e.visitor_id,
    session_id: e.session_id,
    event_type: e.event_type,
    vin: e.vin,
    stock: e.stock,
    vehicle_id: e.vehicle_id,
    created_at: eventAt(e) || null,
    metadata: e.metadata,
  }));
  const alerts = deriveManagerAlerts(alertRows, { limit: 200 });

  for (const alert of alerts) {
    if (!linkedVisitorIds.has(alert.visitorId)) continue;
    for (const d of drafts.values()) if (d.visitorIds.has(alert.visitorId)) d.alerts.push(alert);
  }

  const customers: CustomerEntry[] = [];

  for (const d of drafts.values()) {
    const rollups = [...d.visitorIds].map((v) => visitorRollups.get(v)).filter((r): r is VisitorRollup => !!r);
    const engagement = mergeRollups(rollups, dwell, null);
    customers.push(finishCustomer(d, engagement, listingByVin, agentName, now));
  }

  // Anonymous shoppers: a visitor with a real intent action and NO proven
  // identity. One entry per shopper+vehicle, exactly as the alert engine
  // groups them. Passive-only visitors are counted, never listed as rows.
  let passiveVisitors = 0;
  const alertedVisitors = new Set(alerts.map((a) => a.visitorId));
  for (const [visitorId] of visitorRollups) {
    if (linkedVisitorIds.has(visitorId)) continue;
    if (!alertedVisitors.has(visitorId)) passiveVisitors += 1;
  }

  for (const alert of alerts) {
    if (linkedVisitorIds.has(alert.visitorId)) continue;
    const rollup = visitorRollups.get(alert.visitorId);
    if (!rollup) continue;
    const vin = alert.vehicle.vin ? upper(alert.vehicle.vin) : null;
    const engagement = mergeRollups([rollup], dwell, vin);
    const draft: Draft = {
      id: `anon:${alert.key}`,
      identified: false,
      name: null,
      email: null,
      phone: null,
      leads: [],
      documentRequests: [],
      deals: [],
      visitorIds: new Set([alert.visitorId]),
      vins: new Set(vin ? [vin] : []),
      alerts: [alert],
    };
    customers.push(finishCustomer(draft, engagement, listingByVin, agentName, now));
  }

  customers.sort((a, b) => {
    const rank = { hot: 0, follow_up: 1, working: 2, won: 3, lost: 4 } as const;
    const r = rank[a.bucket] - rank[b.bucket];
    if (r !== 0) return r;
    return (b.lastActivityAt || "").localeCompare(a.lastActivityAt || "");
  });

  deals.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return { customers, deals, passiveVisitors, linkedVisitors: linkedVisitorIds.size };
}

const leadStatusOf = (leads: LeadRow[]): string => {
  const order = ["converted", "lost", "contacted", "new"];
  for (const s of order) if (leads.some((l) => norm(l.status) === s)) return s;
  return leads.length ? norm(leads[0].status) || "new" : "";
};

function finishCustomer(
  d: Draft,
  engagement: EngagementRollup,
  listingByVin: Map<string, ListingRow>,
  agentName: Map<string, string>,
  now: number,
): CustomerEntry {
  const vehicles: VehicleOfInterest[] = [];
  const seen = new Set<string>();
  const addVehicle = (vin: string | null, label: string, stock: string | null, source: string) => {
    const key = vin || label;
    const existing = vehicles.find((v) => (v.vin || v.label) === key);
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
      return;
    }
    if (seen.has(key)) return;
    seen.add(key);
    const listing = vin ? listingByVin.get(vin) || null : null;
    vehicles.push({
      vin,
      label: norm(listing?.ymm) || label,
      stock: stock || listing?.stock_number || null,
      listingId: listing?.id || null,
      slug: listing?.slug || vin,
      sources: [source],
    });
  };

  for (const lead of d.leads) addVehicle(lead.vehicle_vin ? upper(lead.vehicle_vin) : null, vehicleLabelOf(lead.vehicle_interest, lead.vehicle_vin, null), null, "Lead");
  for (const req of d.documentRequests) addVehicle(req.vin ? upper(req.vin) : null, vehicleLabelOf(null, req.vin, req.stock), req.stock, "Document request");
  for (const deal of d.deals) addVehicle(deal.vin, deal.vehicleLabel, deal.stock, "Deal");
  for (const alert of d.alerts) addVehicle(alert.vehicle.vin ? upper(alert.vehicle.vin) : null, alert.vehicle.label, alert.vehicle.stock, "Passport activity");
  for (const vin of d.vins) if (!seen.has(vin)) addVehicle(vin, vehicleLabelOf(null, vin, null), null, "Activity");

  const activity: ActivityItem[] = [];
  for (const lead of d.leads) {
    activity.push({
      at: lead.captured_at,
      label: "Lead captured",
      detail: `${norm(lead.source) || "unknown source"}${lead.sub_source ? ` / ${lead.sub_source}` : ""}${lead.vehicle_interest ? ` - ${lead.vehicle_interest}` : ""}`,
      kind: "lead",
    });
    if (lead.first_response_at) activity.push({ at: lead.first_response_at, label: "First response logged", detail: "The store answered this lead.", kind: "lead" });
    if (lead.escalated_at) activity.push({ at: lead.escalated_at, label: "Escalated", detail: `Escalation level ${lead.escalation_level ?? 1} - the response clock ran out.`, kind: "lead" });
  }
  for (const req of d.documentRequests) {
    activity.push({
      at: req.requested_at,
      label: "Requested documents",
      detail: `Delivery ${norm(req.delivery_status) || "requested"}${req.delivered_at ? ` - sent ${relativeTime(req.delivered_at, now)}` : ""}. This request is what ties their browsing to their name.`,
      kind: "document",
    });
  }
  for (const deal of d.deals) {
    activity.push({ at: deal.createdAt, label: "Deal created", detail: `${deal.vehicleLabel} - ${money(deal.amount)}`, kind: "deal" });
    if (deal.signedAt) activity.push({ at: deal.signedAt, label: "Customer signed", detail: deal.vehicleLabel, kind: "signature" });
    if (deal.deliveredAt) activity.push({ at: deal.deliveredAt, label: "Delivered", detail: deal.vehicleLabel, kind: "deal" });
    if (deal.returnInfo?.requestedAt) activity.push({ at: deal.returnInfo.requestedAt, label: "Return requested", detail: deal.returnInfo.reason || "No reason given.", kind: "return" });
  }
  for (const fact of engagement.facts) activity.push({ at: fact.lastAt, label: fact.label, detail: fact.action, kind: "engagement" });
  activity.sort((a, b) => (b.at || "").localeCompare(a.at || ""));

  const lastActivityAt = [
    engagement.lastAt,
    ...d.leads.map((l) => l.first_response_at || l.captured_at),
    ...d.documentRequests.map((r) => r.requested_at),
    ...d.deals.map((x) => x.updatedAt),
  ]
    .filter((v): v is string => !!v)
    .sort()
    .pop() || null;

  const routedAgent = d.leads.map((l) => l.routed_agent_id).find((v) => !!v) || null;
  const dealEmployee = d.deals.map((x) => x.employeeName).find((v) => !!v) || null;
  const assignedEmployee = routedAgent
    ? { name: agentName.get(routedAgent) || routedAgent, source: "Passport routing" }
    : dealEmployee
      ? { name: dealEmployee, source: "Deal" }
      : null;

  const returnDeal = d.deals.find((x) => x.returnInfo);
  const returnStatus = returnDeal?.returnInfo
    ? { label: returnDeal.returnInfo.label, detail: `SB 766 three-day return on ${returnDeal.vehicleLabel}.` }
    : engagement.linked && engagement.sessions > 1
      ? { label: `Returned - ${engagement.sessions} visits`, detail: `Across ${engagement.visitDays} ${engagement.visitDays === 1 ? "day" : "days"}.` }
      : engagement.linked && engagement.sessions === 1
        ? { label: "First visit only", detail: "No repeat visit tracked yet." }
        : { label: "No tracked visits", detail: "No passport activity is linked to this customer." };

  const status = leadStatusOf(d.leads);
  const openDeal = d.deals.find((x) => x.state === "out_for_signature") || null;
  const signedDeal = d.deals.find((x) => x.state === "signed") || null;
  const deliveredDeal = d.deals.find((x) => x.state === "delivered") || null;
  const unanswered = d.leads.find((l) => !l.first_response_at) || null;
  const hotAlert = d.alerts.find((a) => a.severity === "hot") || null;
  const recentEngagement = !!engagement.lastAt && now - new Date(engagement.lastAt).getTime() < HOT_WINDOW_MS;

  let bucket: CustomerBucket;
  if (deliveredDeal || status === "converted") bucket = "won";
  else if (status === "lost") bucket = "lost";
  else if (hotAlert && recentEngagement) bucket = "hot";
  else if (unanswered || status === "new") bucket = "follow_up";
  else if (openDeal || signedDeal || status === "contacted" || d.deals.length) bucket = "working";
  else bucket = "follow_up";

  const nextAction = buildNextAction({
    identified: d.identified,
    bucket,
    engagement,
    alerts: d.alerts,
    unanswered,
    openDeal,
    signedDeal,
    deliveredDeal,
    returnDeal: returnDeal || null,
    vehicles,
    phone: d.phone,
    email: d.email,
    now,
  });

  return {
    id: d.id,
    identified: d.identified,
    name: d.identified ? d.name : null,
    email: d.identified ? d.email : null,
    phone: d.identified ? d.phone : null,
    bucket,
    vehicles,
    engagement,
    returnStatus,
    assignedEmployee,
    lastActivityAt,
    nextAction,
    leads: d.leads,
    deals: d.deals,
    documentRequests: d.documentRequests,
    alerts: d.alerts,
    activity: activity.slice(0, 60),
    visitorIds: [...d.visitorIds],
  };
}

interface NextActionInput {
  identified: boolean;
  bucket: CustomerBucket;
  engagement: EngagementRollup;
  alerts: ManagerAlert[];
  unanswered: LeadRow | null;
  openDeal: DealEntry | null;
  signedDeal: DealEntry | null;
  deliveredDeal: DealEntry | null;
  returnDeal: DealEntry | null;
  vehicles: VehicleOfInterest[];
  phone: string | null;
  email: string | null;
  now: number;
}

function buildNextAction(i: NextActionInput): NextAction {
  const vehicle = i.vehicles[0]?.label || "the vehicle";
  if (i.returnDeal?.returnInfo?.status === "requested") {
    return { headline: "Answer the return request", detail: `${vehicle} - requested ${relativeTime(i.returnDeal.returnInfo.requestedAt, i.now)}.`, kind: "return" };
  }
  if (!i.identified) {
    const topAction = i.alerts[0]?.suggestedAction || i.engagement.facts[0]?.action || "Watch the vehicle, not the person.";
    return {
      headline: "No contact captured - work the vehicle",
      detail: `${topAction} This is demand on ${vehicle}: price it, re-post it, and have someone on the lot. There is no phone or email to reach this shopper.`,
      kind: "vehicle",
    };
  }
  if (i.unanswered) {
    const waited = relativeTime(i.unanswered.captured_at, i.now);
    if (i.phone) return { headline: `Call ${i.phone}`, detail: `Captured ${waited} with no response logged. ${i.unanswered.vehicle_interest || vehicle}.`, kind: "call" };
    if (i.email) return { headline: `Email ${i.email}`, detail: `Captured ${waited} with no response logged and no phone on file.`, kind: "email" };
    return { headline: "No usable contact on this lead", detail: `Captured ${waited} with neither a phone nor an email. Check the source form.`, kind: "none" };
  }
  if (i.openDeal) return { headline: i.openDeal.nextAction.headline, detail: i.openDeal.nextAction.detail, kind: i.openDeal.nextAction.kind };
  if (i.signedDeal) return { headline: "Confirm delivery", detail: `${i.signedDeal.vehicleLabel} is signed. Record delivery date and mileage.`, kind: "delivery" };
  if (i.returnDeal?.returnInfo?.status === "eligible" && i.returnDeal.returnInfo.closesAt && new Date(i.returnDeal.returnInfo.closesAt).getTime() > i.now) {
    return { headline: "Return window still open", detail: `Closes ${relativeTime(i.returnDeal.returnInfo.closesAt, i.now)} on ${i.returnDeal.vehicleLabel}.`, kind: "return" };
  }
  if (i.bucket === "hot") {
    const alert = i.alerts[0];
    return { headline: alert?.suggestedAction || "Reach out while they are engaged", detail: `${i.engagement.facts[0]?.label || "Recent passport activity"} on ${vehicle}, ${relativeTime(i.engagement.lastAt, i.now)}.`, kind: i.phone ? "call" : "email" };
  }
  if (i.deliveredDeal) return { headline: "Delivered - ask for the review", detail: `${i.deliveredDeal.vehicleLabel} delivered ${relativeTime(i.deliveredDeal.deliveredAt, i.now)}.`, kind: "none" };
  if (i.bucket === "lost") return { headline: "Marked lost", detail: i.engagement.linked && i.engagement.lastAt ? `They were still on the passport ${relativeTime(i.engagement.lastAt, i.now)} - reopen if that continues.` : "Reopen only if new activity arrives.", kind: "none" };
  if (i.engagement.linked && i.engagement.facts.length) {
    return { headline: i.engagement.facts[0].action, detail: `${i.engagement.facts[0].label} on ${vehicle}, ${relativeTime(i.engagement.facts[0].lastAt, i.now)}.`, kind: i.phone ? "call" : "email" };
  }
  return { headline: "Keep working the customer", detail: `No new passport activity is linked to them. Last touch ${relativeTime(i.engagement.lastAt, i.now)}.`, kind: i.phone ? "call" : "email" };
}
