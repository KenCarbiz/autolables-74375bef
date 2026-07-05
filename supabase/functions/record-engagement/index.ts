import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ──────────────────────────────────────────────────────────────
// record-engagement
//
// Public, anonymous write path for shopper engagement events. The
// browser tracker (src/lib/engagement/customerEngagement.ts) posts
// here instead of inserting into customer_engagement_events directly
// — anon has no RLS INSERT grant, so every direct client insert was
// silently dropped (the table sat at 0 rows). This function inserts
// via the service role (bypassing RLS) and enriches each event with
// data the browser cannot be trusted for: the real client IP, an
// authoritative user-agent parse (device / browser / OS), and geo
// (country / region / city) from edge headers when present.
//
// MUST be deployed with JWT verification OFF (public): the tracker
// uses navigator.sendBeacon on page unload, which cannot attach the
// anon apikey/Authorization header.
//
// Contract:
//   POST /functions/v1/record-engagement
//   Body: { events: EngagementEvent[] }  (or { event: EngagementEvent })
//   - up to 20 events per request; extras are ignored.
//   Returns: 200 { ok: true, inserted: n } — always, even on a
//   validation miss or DB error, so the shopper UI never sees a
//   failure. 429 { ok: false, error: "rate_limited" } when an IP
//   exceeds 300 events / 5 min.
//
// Never throws to the client. Fire-and-forget from the browser.
// ──────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });

const clientIp = (req: Request) =>
  req.headers.get("cf-connecting-ip") ||
  (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
  req.headers.get("x-real-ip") ||
  "";

// Only pass a valid-looking address to an `inet` column — a bogus value
// ("unknown", a proxy label) would abort the insert. Loose check: IPv4
// dotted-quad or anything with a colon (IPv6).
const asInet = (ip: string): string | null => {
  const v = (ip || "").trim();
  if (!v) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return v;
  if (v.includes(":") && /^[0-9a-fA-F:.]+$/.test(v)) return v;
  return null;
};

// Header fan-out: read whatever the edge in front of us exposes
// (Cloudflare or Vercel). Never fabricate — return null when absent.
const firstHeader = (req: Request, names: string[]): string | null => {
  for (const n of names) {
    const v = req.headers.get(n);
    if (v && v.trim()) return v.trim();
  }
  return null;
};

// Server-authoritative user-agent parse. Deliberately coarse — enough
// to bucket a shopper's device without a UA-parsing dependency.
const parseUa = (ua: string): { device_type: string; browser: string; os: string } => {
  const s = (ua || "").toLowerCase();
  let device_type = "desktop";
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(s)) device_type = "tablet";
  else if (/mobi|iphone|ipod|android|blackberry|iemobile|opera mini/.test(s)) device_type = "mobile";

  let browser = "unknown";
  if (/edg\//.test(s)) browser = "Edge";
  else if (/opr\/|opera/.test(s)) browser = "Opera";
  else if (/samsungbrowser/.test(s)) browser = "Samsung Internet";
  else if (/firefox|fxios/.test(s)) browser = "Firefox";
  else if (/chrome|crios/.test(s)) browser = "Chrome";
  else if (/safari/.test(s)) browser = "Safari";

  let os = "unknown";
  if (/iphone|ipad|ipod|ios/.test(s)) os = "iOS";
  else if (/android/.test(s)) os = "Android";
  else if (/windows/.test(s)) os = "Windows";
  else if (/mac os x|macintosh/.test(s)) os = "macOS";
  else if (/cros/.test(s)) os = "ChromeOS";
  else if (/linux/.test(s)) os = "Linux";

  return { device_type, browser, os };
};

// Mirrors the table's CHECK constraint. Any event_type outside this set
// is dropped (inserting it would abort the whole batch on the CHECK).
const EVENT_TYPES = new Set([
  "passport_opened", "window_sticker_scanned", "public_listing_opened", "packet_opened",
  "document_opened", "document_downloaded", "document_printed", "photo_viewed",
  "video_played", "cta_clicked", "lead_form_opened", "lead_submitted", "share_clicked",
  "call_clicked", "text_clicked", "directions_clicked", "finance_clicked", "trade_clicked",
  "scroll_depth", "time_on_page", "engagement_ping",
  "customer_passport_opened", "customer_passport_closed", "customer_passport_reserve_clicked",
  "customer_passport_trade_clicked", "customer_passport_call_clicked", "customer_passport_contact_clicked",
]);
const SOURCES = new Set(["passport", "window_sticker_qr", "website", "email", "sms", "direct", "unknown"]);
const SURFACES = new Set([
  "vehicle_passport", "window_sticker", "public_listing", "document_packet",
  "document_viewer", "lead_form", "unknown",
]);

const str = (v: unknown, max = 500): string | null => {
  if (v == null) return null;
  const s = String(v);
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
};

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

// deno-lint-ignore no-explicit-any
const buildRow = (e: any, ip: string | null, ua: string, geo: { country: string | null; region: string | null; city: string | null }): Row | null => {
  if (!e || typeof e !== "object") return null;
  const eventType = typeof e.event_type === "string" ? e.event_type : "";
  if (!EVENT_TYPES.has(eventType)) return null;

  const device = parseUa(ua);

  // event_label and section are not columns — fold them into metadata so the
  // signal survives without violating the schema.
  const rawMeta = e.metadata && typeof e.metadata === "object" && !Array.isArray(e.metadata) ? e.metadata : {};
  const metadata: Row = { ...rawMeta };
  const label = str(e.event_label, 200);
  const section = str(e.section, 200);
  if (label && metadata.event_label == null) metadata.event_label = label;
  if (section && metadata.section == null) metadata.section = section;

  const source = SOURCES.has(e.source) ? e.source : "unknown";
  const surface = SURFACES.has(e.surface) ? e.surface : "unknown";

  const row: Row = {
    tenant_id: str(e.tenant_id, 100),
    store_id: str(e.store_id, 100),
    vehicle_id: str(e.vehicle_id, 100),
    vin: str(e.vin, 40),
    stock: str(e.stock, 80),
    session_id: str(e.session_id, 200) || `srv_${crypto.randomUUID()}`,
    visitor_id: str(e.visitor_id, 200),
    source,
    surface,
    event_type: eventType,
    document_type: str(e.document_type, 120),
    document_id: str(e.document_id, 200),
    document_title: str(e.document_title, 300),
    packet_id: str(e.packet_id, 200),
    qr_token: str(e.qr_token, 200),
    referrer: str(e.referrer, 2000),
    landing_url: str(e.landing_url, 2000),
    user_agent: str(ua, 2000),
    ip_address: ip,
    device_type: device.device_type,
    browser: device.browser,
    os: device.os,
    country: geo.country,
    region: geo.region,
    city: geo.city,
    metadata,
  };

  // Honor a client occurred_at only when it parses; otherwise the column
  // defaults to now() server-side.
  const occurred = typeof e.occurred_at === "string" ? Date.parse(e.occurred_at) : NaN;
  if (!Number.isNaN(occurred)) row.occurred_at = new Date(occurred).toISOString();

  return row;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json(200, { ok: true, inserted: 0 });

    const body = await req.json().catch(() => ({}));
    // deno-lint-ignore no-explicit-any
    const incoming: any[] = Array.isArray(body?.events)
      ? body.events
      : body?.event
        ? [body.event]
        : [];
    if (!incoming.length) return json(200, { ok: true, inserted: 0 });

    const rawIp = clientIp(req);
    const ip = asInet(rawIp);
    const ua = req.headers.get("user-agent") || "";
    const geo = {
      country: firstHeader(req, ["cf-ipcountry", "x-vercel-ip-country"]),
      region: firstHeader(req, ["cf-region", "cf-region-code", "x-vercel-ip-country-region"]),
      city: firstHeader(req, ["cf-ipcity", "x-vercel-ip-city"]),
    };

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ── Rate limit: 300 events / 5 min per IP. Only enforceable when we have a
    // real address; without one we can't attribute, so we let it through.
    if (ip) {
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      const { count } = await admin
        .from("customer_engagement_events")
        .select("id", { head: true, count: "exact" })
        .eq("ip_address", ip)
        .gte("created_at", fiveMinAgo);
      if ((count ?? 0) >= 300) {
        return json(429, { ok: false, error: "rate_limited" }, { "Retry-After": "300" });
      }
    }

    const rows = incoming
      .slice(0, 20)
      .map((e) => buildRow(e, ip, ua, geo))
      .filter((r): r is Row => r != null);
    if (!rows.length) return json(200, { ok: true, inserted: 0 });

    const { error } = await admin.from("customer_engagement_events").insert(rows);
    if (error) return json(200, { ok: true, inserted: 0 });

    return json(200, { ok: true, inserted: rows.length });
  } catch (_err) {
    // Never surface an error to the shopper — engagement is best-effort.
    return json(200, { ok: true, inserted: 0 });
  }
});
