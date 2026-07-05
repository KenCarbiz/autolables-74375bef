// ──────────────────────────────────────────────────────────────────────
// shopperActivity — pure data layer for the internal "Shopper Activity"
// intelligence slide-out. Managers use it to see how shoppers interact with
// a vehicle passport; the product team uses it to find where attention drops.
//
// HONESTY RULE: every number here is derived from real captured rows. A metric
// whose signal is not being captured yet is marked tracked:false (rendered as
// "Not tracked yet"), never a fabricated value. buildShopperActivity is a pure
// function so it is unit-testable and can be driven by fixtures.
// ──────────────────────────────────────────────────────────────────────

export type ShopperActivityRange = "all" | "24h" | "7d" | "30d";

// Raw row shapes as returned by the client queries. Kept loose (optional +
// nullable) so a thin/partial row never throws.
export interface RawPassportEngagementRow {
  session_id: string;
  module: string;
  seconds: number | null;
  first_at?: string | null;
  last_at?: string | null;
}

export interface RawEngagementEventRow {
  id?: string | null;
  session_id: string;
  visitor_id?: string | null;
  vin?: string | null;
  source?: string | null;
  surface?: string | null;
  event_type: string;
  document_type?: string | null;
  document_title?: string | null;
  referrer?: string | null;
  landing_url?: string | null;
  device_type?: string | null;
  browser?: string | null;
  os?: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  metadata?: Record<string, unknown> | null;
  occurred_at: string;
}

export interface RawQrScanRow {
  device_type?: string | null;
  browser?: string | null;
  referrer?: string | null;
  sticker_type?: string | null;
  scanned_at: string;
}

export interface RawLeadRow {
  vehicle_vin?: string | null;
  name?: string | null;
  source?: string | null;
  sub_source?: string | null;
  status?: string | null;
  captured_at: string;
  first_response_at?: string | null;
}

// Events for OTHER vins by the same visitor_id set — used for the "similar
// vehicle activity" cross-shopping signal. Optional; omit when not fetched.
export interface RawCrossVehicleEventRow {
  visitor_id?: string | null;
  vin?: string | null;
  event_type?: string | null;
  occurred_at: string;
  metadata?: Record<string, unknown> | null;
}

export interface ShopperActivityInput {
  currentVin?: string | null;
  viewCount?: number | null;
  engagement?: RawPassportEngagementRow[] | null;
  events?: RawEngagementEventRow[] | null;
  qrScans?: RawQrScanRow[] | null;
  leads?: RawLeadRow[] | null;
  crossVehicleEvents?: RawCrossVehicleEventRow[] | null;
}

export interface MetricValue {
  key: string;
  label: string;
  value: number | null;
  display: string;
  tracked: boolean;
  tone?: "default" | "positive" | "watching";
}

export interface SectionEngagement {
  module: string;
  label: string;
  seconds: number;
  pct: number;
  sessions: number;
  lastViewedAt: string | null;
}

export interface TimelineEntry {
  at: string;
  kind: "section" | "event";
  key: string;
  label: string;
  seconds?: number;
  section?: string | null;
}

export interface SessionSummary {
  sessionId: string;
  visitorId: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  location: string | null;
  source: string | null;
  firstAt: string | null;
  lastAt: string | null;
  totalSeconds: number;
  entries: TimelineEntry[];
  hasCta: boolean;
  hasLead: boolean;
  leadFormAbandoned: boolean;
  returning: boolean;
}

export interface ClickstreamEntry {
  id: string;
  at: string;
  eventType: string;
  label: string;
  section: string | null;
  device: string | null;
}

export interface ShopperContext {
  hasAny: boolean;
  locations: string[];
  devices: string[];
  browsers: string[];
  oses: string[];
  sources: string[];
  referrers: string[];
  returningVisitors: number;
  newVisitors: number;
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface SimilarVehicle {
  vin: string;
  visitors: number;
  events: number;
  lastAt: string | null;
}

export type TriggerState = "active" | "watching" | "inactive";
export interface BehaviorTrigger {
  key: string;
  label: string;
  state: TriggerState;
  detail: string;
}

export interface ScoreFactor {
  key: string;
  label: string;
  points: number;
  max: number;
  detail: string;
}

export type EngagementLevel = "Low" | "Browsing" | "Moderate" | "High" | "Hot";
export interface EngagementScore {
  score: number;
  level: EngagementLevel;
  factors: ScoreFactor[];
}

export interface ShopperActivitySummary {
  hasAnyData: boolean;
  totals: {
    views: number | null;
    sessions: number;
    totalSeconds: number;
    ctaClicks: number;
    leadFormOpens: number;
    leadSubmits: number;
    qrScans: number;
    returningVisitors: number;
    topSection: { module: string; label: string; seconds: number } | null;
    maxScrollDepth: number | null;
  };
  metrics: MetricValue[];
  sectionEngagement: SectionEngagement[];
  sessions: SessionSummary[];
  clickstream: ClickstreamEntry[];
  shopperContext: ShopperContext;
  similarVehicles: SimilarVehicle[];
  behaviorTriggers: BehaviorTrigger[];
  score: EngagementScore;
  insights: string[];
}

// ── Label maps ─────────────────────────────────────────────────────────

// Kept in sync with ShopperFocus.tsx's module map so the drawer and the card
// name sections identically.
export const MODULE_LABEL: Record<string, string> = {
  "vehicle-details": "Vehicle Details",
  market: "Market Intelligence",
  highlights: "Vehicle Highlights",
  overview: "Vehicle Overview",
  recon: "Reconditioning & Inspection",
  warranty: "Warranty",
  dealer: "Why Buy Here",
  "market-price": "Market Price",
  "price-history": "Price History",
  "key-specs": "Specifications",
  equipment: "Equipment & Options",
  "great-buy": "Why It's a Great Buy",
  "vehicle-history": "Vehicle History",
  "factory-warranty": "Warranty Detail",
  "owner-reviews": "Reviews",
  gallery: "Photo Gallery",
  photos: "Photo Gallery",
  pricing: "Pricing",
  financing: "Financing",
  contact: "Contact Dealer",
};

export const moduleLabel = (k: string): string =>
  MODULE_LABEL[k] || k.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const EVENT_LABEL: Record<string, string> = {
  passport_opened: "Opened passport",
  window_sticker_scanned: "Scanned window sticker",
  public_listing_opened: "Opened listing",
  packet_opened: "Opened document packet",
  document_opened: "Opened document",
  document_downloaded: "Downloaded document",
  document_printed: "Printed document",
  photo_viewed: "Viewed photos",
  video_played: "Played video",
  cta_clicked: "Clicked a call-to-action",
  lead_form_opened: "Opened the lead form",
  lead_submitted: "Submitted a lead",
  customer_passport_opened: "Opened passport",
  customer_passport_closed: "Closed passport",
  customer_passport_reserve_clicked: "Clicked Reserve",
  customer_passport_trade_clicked: "Clicked Trade-in",
  customer_passport_call_clicked: "Tapped Call",
  customer_passport_contact_clicked: "Tapped Contact",
  share_clicked: "Shared the passport",
  call_clicked: "Tapped Call",
  text_clicked: "Tapped Text",
  directions_clicked: "Tapped Directions",
  finance_clicked: "Tapped Financing",
  trade_clicked: "Clicked Trade-in",
  scroll_depth: "Scrolled the page",
  time_on_page: "Time on page",
  engagement_ping: "Still on page",
};

export const eventLabel = (t: string): string =>
  EVENT_LABEL[t] || t.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// Any interaction that expresses buying intent / a call-to-action.
const CTA_EVENTS = new Set<string>([
  "cta_clicked",
  "customer_passport_reserve_clicked",
  "customer_passport_trade_clicked",
  "customer_passport_call_clicked",
  "customer_passport_contact_clicked",
  "share_clicked",
  "call_clicked",
  "text_clicked",
  "directions_clicked",
  "finance_clicked",
  "trade_clicked",
]);

// Sections that signal high buying intent when they dominate attention.
const INTENT_SECTIONS = new Set<string>([
  "warranty",
  "factory-warranty",
  "market-price",
  "pricing",
  "price-history",
  "market",
  "financing",
]);

export const mmss = (s: number): string => {
  const sec = Math.max(0, Math.round(s));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
};

// ── Helpers ────────────────────────────────────────────────────────────

const laterIso = (a: string | null, b: string | null): string | null => {
  if (!a) return b;
  if (!b) return a;
  return new Date(a) >= new Date(b) ? a : b;
};
const earlierIso = (a: string | null, b: string | null): string | null => {
  if (!a) return b;
  if (!b) return a;
  return new Date(a) <= new Date(b) ? a : b;
};

const sectionForEvent = (e: RawEngagementEventRow): string | null => {
  const m = e.metadata || {};
  const raw = m.module ?? m.section ?? e.document_type ?? e.document_title;
  return raw != null && String(raw).trim() !== "" ? String(raw) : null;
};

const scrollDepthOf = (e: RawEngagementEventRow): number | null => {
  const m = e.metadata || {};
  const raw = m.depth ?? m.percent ?? m.scroll_depth ?? m.scrollDepth ?? m.value;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? parseFloat(raw) : NaN;
  return Number.isFinite(n) ? n : null;
};

const locationOf = (e: { city?: string | null; region?: string | null; country?: string | null }): string | null => {
  const parts = [e.city, e.region, e.country].filter((p) => p != null && String(p).trim() !== "");
  return parts.length ? parts.slice(0, 2).join(", ") : null;
};

const uniqSorted = (items: (string | null | undefined)[]): string[] =>
  [...new Set(items.filter((i): i is string => i != null && String(i).trim() !== ""))].sort();

// ── The empty summary — used for no-data and as a safe default. ──────────

export const emptyShopperActivity = (viewCount?: number | null): ShopperActivitySummary => {
  const views = viewCount == null ? null : viewCount;
  return {
    hasAnyData: false,
    totals: {
      views,
      sessions: 0,
      totalSeconds: 0,
      ctaClicks: 0,
      leadFormOpens: 0,
      leadSubmits: 0,
      qrScans: 0,
      returningVisitors: 0,
      topSection: null,
      maxScrollDepth: null,
    },
    metrics: buildMetrics(views, 0, 0, 0, 0, 0, 0, 0, null, null, false),
    sectionEngagement: [],
    sessions: [],
    clickstream: [],
    shopperContext: {
      hasAny: false,
      locations: [],
      devices: [],
      browsers: [],
      oses: [],
      sources: [],
      referrers: [],
      returningVisitors: 0,
      newVisitors: 0,
      firstSeen: null,
      lastSeen: null,
    },
    similarVehicles: [],
    behaviorTriggers: buildTriggers({
      returningVisitors: 0,
      intentSectionPct: 0,
      ctaClicks: 0,
      abandonedForms: 0,
      leadFormOpens: 0,
      maxSessionSeconds: 0,
      totalSeconds: 0,
      qrScans: 0,
      qrSourcedEvents: 0,
    }),
    score: { score: 0, level: "Low", factors: buildScoreFactors(0, 0, 0, 0, 0, 0, 0, 0).factors },
    insights: ["No shopper activity captured yet. Insights appear once a shopper opens this vehicle's passport."],
  };
};

// ── Metric builder (shared by empty + full paths) ────────────────────────

function buildMetrics(
  views: number | null,
  sessions: number,
  totalSeconds: number,
  ctaClicks: number,
  leadFormOpens: number,
  leadSubmits: number,
  qrScans: number,
  returningVisitors: number,
  topSection: { label: string } | null,
  maxScrollDepth: number | null,
  hasVisitorIds: boolean,
): MetricValue[] {
  const num = (key: string, label: string, value: number | null, display: string, tone?: MetricValue["tone"]): MetricValue => ({
    key,
    label,
    value,
    display: value == null ? "Not tracked yet" : display,
    tracked: value != null,
    tone,
  });
  return [
    num("views", "Total views", views, (views ?? 0).toLocaleString()),
    num("sessions", "Sessions", sessions, sessions.toLocaleString()),
    num("time", "Total time", totalSeconds, mmss(totalSeconds)),
    num("cta", "CTA clicks", ctaClicks, ctaClicks.toLocaleString(), ctaClicks > 0 ? "positive" : "default"),
    num("leadOpens", "Lead-form opens", leadFormOpens, leadFormOpens.toLocaleString()),
    num("leadSubmits", "Lead submits", leadSubmits, leadSubmits.toLocaleString(), leadSubmits > 0 ? "positive" : "default"),
    num("qr", "QR scans", qrScans, qrScans.toLocaleString()),
    {
      key: "topSection",
      label: "Most interest",
      value: topSection ? 1 : null,
      display: topSection ? topSection.label : "Not tracked yet",
      tracked: !!topSection,
    },
    // Returning visitors is only knowable when visitor ids are present.
    num("returning", "Returning visitors", hasVisitorIds ? returningVisitors : null, returningVisitors.toLocaleString(), returningVisitors > 0 ? "positive" : "default"),
    // Scroll depth is null unless at least one scroll_depth event was captured.
    {
      key: "scrollDepth",
      label: "Scroll depth reached",
      value: maxScrollDepth,
      display: maxScrollDepth == null ? "Not tracked yet" : `${Math.round(maxScrollDepth)}%`,
      tracked: maxScrollDepth != null,
    },
  ];
}

// ── Behavior triggers ────────────────────────────────────────────────────

interface TriggerInputs {
  returningVisitors: number;
  intentSectionPct: number;
  ctaClicks: number;
  abandonedForms: number;
  leadFormOpens: number;
  maxSessionSeconds: number;
  totalSeconds: number;
  qrScans: number;
  qrSourcedEvents: number;
}

function buildTriggers(i: TriggerInputs): BehaviorTrigger[] {
  const HIGH_TIME = 180;
  const WATCH_TIME = 60;
  return [
    {
      key: "returning",
      label: "Returning shopper",
      state: i.returningVisitors > 0 ? "active" : "inactive",
      detail: i.returningVisitors > 0 ? `${i.returningVisitors} visitor(s) came back for a second session` : "No repeat visitors yet",
    },
    {
      key: "intent-section",
      label: "High-intent section interest",
      state: i.intentSectionPct >= 40 ? "active" : i.intentSectionPct >= 15 ? "watching" : "inactive",
      detail:
        i.intentSectionPct > 0
          ? `${Math.round(i.intentSectionPct)}% of attention is on warranty / pricing sections`
          : "No dwell on warranty or pricing yet",
    },
    {
      key: "cta",
      label: "CTA clicked",
      state: i.ctaClicks > 0 ? "active" : "inactive",
      detail: i.ctaClicks > 0 ? `${i.ctaClicks} call-to-action click(s)` : "No CTA clicks yet",
    },
    {
      key: "lead-abandoned",
      label: "Lead-form abandoned",
      state: i.abandonedForms > 0 ? "active" : i.leadFormOpens > 0 ? "watching" : "inactive",
      detail:
        i.abandonedForms > 0
          ? `${i.abandonedForms} session(s) opened the form without submitting`
          : i.leadFormOpens > 0
            ? "Lead form opened and submitted — no abandonment"
            : "Lead form not opened yet",
    },
    {
      key: "high-time",
      label: "High time-on-packet",
      state: i.maxSessionSeconds >= HIGH_TIME ? "active" : i.maxSessionSeconds >= WATCH_TIME || i.totalSeconds >= HIGH_TIME ? "watching" : "inactive",
      detail:
        i.maxSessionSeconds > 0
          ? `Longest session ${mmss(i.maxSessionSeconds)} · ${mmss(i.totalSeconds)} total`
          : "No measured dwell time yet",
    },
    {
      key: "qr-lot",
      label: "QR-from-lot",
      state: i.qrScans > 0 || i.qrSourcedEvents > 0 ? "active" : "inactive",
      detail:
        i.qrScans > 0 || i.qrSourcedEvents > 0
          ? `${i.qrScans + i.qrSourcedEvents} scan(s) from the window sticker`
          : "No lot QR scans yet",
    },
  ];
}

// ── Engagement score ─────────────────────────────────────────────────────

function buildScoreFactors(
  views: number,
  sessions: number,
  returningVisitors: number,
  totalSeconds: number,
  topSectionSeconds: number,
  ctaClicks: number,
  leadFormOpens: number,
  leadSubmits: number,
): EngagementScore {
  const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));
  const scaled = (v: number, cap: number, max: number) => Math.round(clamp((v / cap) * max, max));

  const ctaSignal = ctaClicks + leadFormOpens * 2 + leadSubmits * 4;

  const factors: ScoreFactor[] = [
    { key: "views", label: "Views", points: scaled(views, 30, 15), max: 15, detail: `${views.toLocaleString()} total view(s)` },
    { key: "sessions", label: "Sessions", points: scaled(sessions, 10, 15), max: 15, detail: `${sessions.toLocaleString()} visit session(s)` },
    { key: "return", label: "Return visits", points: scaled(returningVisitors, 5, 15), max: 15, detail: `${returningVisitors.toLocaleString()} returning visitor(s)` },
    { key: "time", label: "Total time", points: scaled(totalSeconds, 600, 20), max: 20, detail: `${mmss(totalSeconds)} on the packet` },
    { key: "focus", label: "Top-section focus", points: scaled(topSectionSeconds, 300, 15), max: 15, detail: `${mmss(topSectionSeconds)} on the top section` },
    { key: "cta", label: "CTA / lead events", points: scaled(ctaSignal, 8, 20), max: 20, detail: `${ctaClicks} CTA · ${leadFormOpens} form open(s) · ${leadSubmits} submit(s)` },
  ];

  const score = clamp(
    factors.reduce((s, f) => s + f.points, 0),
    100,
  );
  const level: EngagementLevel = score >= 80 ? "Hot" : score >= 60 ? "High" : score >= 35 ? "Moderate" : score >= 15 ? "Browsing" : "Low";
  return { score, level, factors };
}

// ── The main pure builder ────────────────────────────────────────────────

export function buildShopperActivity(input: ShopperActivityInput): ShopperActivitySummary {
  const engagement = input.engagement ?? [];
  const events = input.events ?? [];
  const qrScans = input.qrScans ?? [];
  const leads = input.leads ?? [];
  const cross = input.crossVehicleEvents ?? [];
  const views = input.viewCount == null ? null : input.viewCount;

  if (!engagement.length && !events.length && !qrScans.length && !leads.length) {
    return emptyShopperActivity(views);
  }

  // ── Section engagement (strongest real signal) ──
  const byModule = new Map<string, { seconds: number; sessions: Set<string>; lastAt: string | null }>();
  for (const r of engagement) {
    const cur = byModule.get(r.module) || { seconds: 0, sessions: new Set<string>(), lastAt: null };
    cur.seconds += r.seconds || 0;
    cur.sessions.add(r.session_id);
    cur.lastAt = laterIso(cur.lastAt, r.last_at ?? r.first_at ?? null);
    byModule.set(r.module, cur);
  }
  const totalSeconds = [...byModule.values()].reduce((s, m) => s + m.seconds, 0);
  const sectionEngagement: SectionEngagement[] = [...byModule.entries()]
    .map(([module, v]) => ({
      module,
      label: moduleLabel(module),
      seconds: v.seconds,
      pct: totalSeconds > 0 ? (v.seconds / totalSeconds) * 100 : 0,
      sessions: v.sessions.size,
      lastViewedAt: v.lastAt,
    }))
    .sort((a, b) => b.seconds - a.seconds);
  const topSection = sectionEngagement[0]
    ? { module: sectionEngagement[0].module, label: sectionEngagement[0].label, seconds: sectionEngagement[0].seconds }
    : null;
  const intentSectionSeconds = sectionEngagement.filter((s) => INTENT_SECTIONS.has(s.module)).reduce((s, m) => s + m.seconds, 0);
  const intentSectionPct = totalSeconds > 0 ? (intentSectionSeconds / totalSeconds) * 100 : 0;

  // ── Event tallies ──
  const ctaClicks = events.filter((e) => CTA_EVENTS.has(e.event_type)).length;
  const leadFormOpens = events.filter((e) => e.event_type === "lead_form_opened").length;
  const leadSubmitEvents = events.filter((e) => e.event_type === "lead_submitted").length;
  const leadSubmits = leadSubmitEvents + leads.length;
  const scrollEvents = events.filter((e) => e.event_type === "scroll_depth");
  const maxScrollDepth = scrollEvents.length
    ? Math.max(...scrollEvents.map((e) => scrollDepthOf(e) ?? 0))
    : null;
  const qrSourcedEvents = events.filter((e) => e.source === "window_sticker_qr" || e.event_type === "window_sticker_scanned").length;

  // ── Sessions (union of passport dwell + engagement events) ──
  interface SessBuild {
    visitorId: string | null;
    device: string | null;
    browser: string | null;
    os: string | null;
    location: string | null;
    source: string | null;
    firstAt: string | null;
    lastAt: string | null;
    totalSeconds: number;
    entries: TimelineEntry[];
    eventTypes: Set<string>;
  }
  const sessMap = new Map<string, SessBuild>();
  const getSess = (id: string): SessBuild => {
    let s = sessMap.get(id);
    if (!s) {
      s = { visitorId: null, device: null, browser: null, os: null, location: null, source: null, firstAt: null, lastAt: null, totalSeconds: 0, entries: [], eventTypes: new Set() };
      sessMap.set(id, s);
    }
    return s;
  };

  for (const r of engagement) {
    const s = getSess(r.session_id);
    const at = r.first_at ?? r.last_at ?? null;
    s.totalSeconds += r.seconds || 0;
    s.firstAt = earlierIso(s.firstAt, at);
    s.lastAt = laterIso(s.lastAt, r.last_at ?? at);
    if (at) s.entries.push({ at, kind: "section", key: r.module, label: moduleLabel(r.module), seconds: r.seconds || 0, section: r.module });
  }
  for (const e of events) {
    const s = getSess(e.session_id);
    s.visitorId = s.visitorId ?? e.visitor_id ?? null;
    s.device = s.device ?? e.device_type ?? null;
    s.browser = s.browser ?? e.browser ?? null;
    s.os = s.os ?? e.os ?? null;
    s.location = s.location ?? locationOf(e);
    s.source = s.source ?? e.source ?? null;
    s.firstAt = earlierIso(s.firstAt, e.occurred_at);
    s.lastAt = laterIso(s.lastAt, e.occurred_at);
    s.eventTypes.add(e.event_type);
    s.entries.push({ at: e.occurred_at, kind: "event", key: e.event_type, label: eventLabel(e.event_type), section: sectionForEvent(e) });
  }

  // Returning visitors: a visitor_id present in more than one distinct session.
  const visitorSessions = new Map<string, Set<string>>();
  for (const [sid, s] of sessMap.entries()) {
    if (!s.visitorId) continue;
    const set = visitorSessions.get(s.visitorId) || new Set<string>();
    set.add(sid);
    visitorSessions.set(s.visitorId, set);
  }
  const hasVisitorIds = visitorSessions.size > 0;
  const returningVisitors = [...visitorSessions.values()].filter((set) => set.size > 1).length;
  const newVisitors = [...visitorSessions.values()].filter((set) => set.size === 1).length;

  const sessions: SessionSummary[] = [...sessMap.entries()]
    .map(([sessionId, s]) => {
      const hasCta = [...s.eventTypes].some((t) => CTA_EVENTS.has(t));
      const hasLead = s.eventTypes.has("lead_submitted");
      const leadFormAbandoned = s.eventTypes.has("lead_form_opened") && !hasLead;
      return {
        sessionId,
        visitorId: s.visitorId,
        device: s.device,
        browser: s.browser,
        os: s.os,
        location: s.location,
        source: s.source,
        firstAt: s.firstAt,
        lastAt: s.lastAt,
        totalSeconds: s.totalSeconds,
        entries: s.entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()),
        hasCta,
        hasLead,
        leadFormAbandoned,
        returning: s.visitorId ? (visitorSessions.get(s.visitorId)?.size ?? 0) > 1 : false,
      };
    })
    .sort((a, b) => new Date(b.lastAt || 0).getTime() - new Date(a.lastAt || 0).getTime());

  const abandonedForms = sessions.filter((s) => s.leadFormAbandoned).length;
  const maxSessionSeconds = sessions.reduce((m, s) => Math.max(m, s.totalSeconds), 0);

  // ── Clickstream ──
  const clickstream: ClickstreamEntry[] = [...events]
    .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
    .map((e, idx) => ({
      id: e.id || `${e.session_id}-${e.event_type}-${e.occurred_at}-${idx}`,
      at: e.occurred_at,
      eventType: e.event_type,
      label: eventLabel(e.event_type),
      section: sectionForEvent(e),
      device: e.device_type ?? null,
    }));

  // ── Shopper context (privacy-safe aggregates) ──
  let firstSeen: string | null = null;
  let lastSeen: string | null = null;
  for (const e of events) {
    firstSeen = earlierIso(firstSeen, e.occurred_at);
    lastSeen = laterIso(lastSeen, e.occurred_at);
  }
  for (const r of engagement) {
    firstSeen = earlierIso(firstSeen, r.first_at ?? null);
    lastSeen = laterIso(lastSeen, r.last_at ?? r.first_at ?? null);
  }
  for (const q of qrScans) {
    firstSeen = earlierIso(firstSeen, q.scanned_at);
    lastSeen = laterIso(lastSeen, q.scanned_at);
  }
  const shopperContext: ShopperContext = {
    hasAny: events.length > 0 || qrScans.length > 0,
    locations: uniqSorted([...events.map(locationOf), ...qrScans.map(() => null)]),
    devices: uniqSorted([...events.map((e) => e.device_type), ...qrScans.map((q) => q.device_type)]),
    browsers: uniqSorted([...events.map((e) => e.browser), ...qrScans.map((q) => q.browser)]),
    oses: uniqSorted(events.map((e) => e.os)),
    sources: uniqSorted(events.map((e) => e.source)),
    referrers: uniqSorted([...events.map((e) => e.referrer), ...qrScans.map((q) => q.referrer)]),
    returningVisitors,
    newVisitors,
    firstSeen,
    lastSeen,
  };

  // ── Similar-vehicle activity (cross-shopping by visitor_id) ──
  const currentVin = (input.currentVin || "").toUpperCase();
  const byVin = new Map<string, { visitors: Set<string>; events: number; lastAt: string | null }>();
  for (const r of cross) {
    const vin = (r.vin || "").toUpperCase();
    if (!vin || vin === currentVin) continue;
    const cur = byVin.get(vin) || { visitors: new Set<string>(), events: 0, lastAt: null };
    if (r.visitor_id) cur.visitors.add(r.visitor_id);
    cur.events += 1;
    cur.lastAt = laterIso(cur.lastAt, r.occurred_at);
    byVin.set(vin, cur);
  }
  const similarVehicles: SimilarVehicle[] = [...byVin.entries()]
    .map(([vin, v]) => ({ vin, visitors: v.visitors.size, events: v.events, lastAt: v.lastAt }))
    .sort((a, b) => b.events - a.events);

  // ── Triggers + score ──
  const behaviorTriggers = buildTriggers({
    returningVisitors,
    intentSectionPct,
    ctaClicks,
    abandonedForms,
    leadFormOpens,
    maxSessionSeconds,
    totalSeconds,
    qrScans: qrScans.length,
    qrSourcedEvents,
  });
  const score = buildScoreFactors(
    views ?? 0,
    sessions.length,
    returningVisitors,
    totalSeconds,
    topSection?.seconds ?? 0,
    ctaClicks,
    leadFormOpens,
    leadSubmits,
  );

  // ── "What this tells us" — manager/dev insight, from the numbers only ──
  const insights: string[] = [];
  if (topSection && topSection.seconds > 0 && sectionEngagement[0].pct >= 40) {
    const exitBeforeCta = ctaClicks === 0 && sessions.length > 0;
    insights.push(
      exitBeforeCta
        ? `${Math.round(sectionEngagement[0].pct)}% of attention is on ${topSection.label}, but no session reached a CTA — consider a stronger CTA near the ${topSection.label} panel.`
        : `${Math.round(sectionEngagement[0].pct)}% of attention concentrates on ${topSection.label} — the strongest interest driver for this vehicle.`,
    );
  }
  if (abandonedForms > 0) {
    insights.push(`${abandonedForms} session(s) opened the lead form but didn't submit — the form may ask for too much or sit too late in the flow.`);
  }
  if (totalSeconds >= 180 && ctaClicks === 0 && leadSubmits === 0) {
    insights.push(`High dwell time (${mmss(totalSeconds)}) with no CTA clicks — attention isn't converting to action.`);
  }
  if (returningVisitors > 0) {
    insights.push(`${returningVisitors} returning visitor(s) signal sustained interest — a timely prompt could move them to contact.`);
  }
  if (!insights.length) {
    insights.push(
      sessions.length > 0
        ? "Activity is still light — not enough sessions yet to surface a reliable pattern."
        : "Views recorded but no measured section dwell yet — engagement tracking populates as shoppers open the passport.",
    );
  }

  return {
    hasAnyData: true,
    totals: {
      views,
      sessions: sessions.length,
      totalSeconds,
      ctaClicks,
      leadFormOpens,
      leadSubmits,
      qrScans: qrScans.length,
      returningVisitors,
      topSection,
      maxScrollDepth,
    },
    metrics: buildMetrics(views, sessions.length, totalSeconds, ctaClicks, leadFormOpens, leadSubmits, qrScans.length, returningVisitors, topSection, maxScrollDepth, hasVisitorIds),
    sectionEngagement,
    sessions,
    clickstream,
    shopperContext,
    similarVehicles,
    behaviorTriggers,
    score,
    insights: insights.slice(0, 3),
  };
}

// Convert a range selector to an ISO "since" cutoff (null = all time).
export const rangeSince = (range: ShopperActivityRange, now: number = Date.now()): string | null => {
  const day = 24 * 60 * 60 * 1000;
  switch (range) {
    case "24h":
      return new Date(now - day).toISOString();
    case "7d":
      return new Date(now - 7 * day).toISOString();
    case "30d":
      return new Date(now - 30 * day).toISOString();
    default:
      return null;
  }
};

export const RANGE_LABEL: Record<ShopperActivityRange, string> = {
  all: "All time",
  "24h": "24h",
  "7d": "7 days",
  "30d": "30 days",
};
