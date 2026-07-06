export type CustomerEngagementSource = "passport" | "window_sticker_qr" | "website" | "email" | "sms" | "direct" | "unknown";
export type CustomerEngagementSurface = "vehicle_passport" | "window_sticker" | "public_listing" | "document_packet" | "document_viewer" | "lead_form" | "unknown";
export type CustomerEngagementEventType =
  | "passport_opened"
  | "window_sticker_scanned"
  | "public_listing_opened"
  | "packet_opened"
  | "document_opened"
  | "document_downloaded"
  | "document_printed"
  | "photo_viewed"
  | "video_played"
  | "cta_clicked"
  | "lead_form_opened"
  | "lead_submitted"
  | "customer_passport_opened"
  | "customer_passport_closed"
  | "customer_passport_reserve_clicked"
  | "customer_passport_trade_clicked"
  | "customer_passport_call_clicked"
  | "customer_passport_contact_clicked"
  | "share_clicked"
  | "call_clicked"
  | "text_clicked"
  | "directions_clicked"
  | "finance_clicked"
  | "trade_clicked"
  | "scroll_depth"
  | "time_on_page"
  | "engagement_ping";

export type CustomerEngagementPayload = {
  tenantId?: string | null;
  storeId?: string | null;
  vehicleId?: string | null;
  vin?: string | null;
  stock?: string | null;
  sessionId?: string | null;
  visitorId?: string | null;
  source?: CustomerEngagementSource;
  surface?: CustomerEngagementSurface;
  eventType: CustomerEngagementEventType;
  documentType?: string | null;
  documentId?: string | null;
  documentTitle?: string | null;
  packetId?: string | null;
  qrToken?: string | null;
  metadata?: Record<string, unknown>;
};

// Share ONE session id per visit with usePassportEngagement (al_passport_sid)
// so per-section dwell and the clickstream merge into a single session in the
// Shopper Activity timeline instead of appearing as two separate visits.
const SESSION_KEY = "al_passport_sid";
const VISITOR_KEY = "autolabels_engagement_visitor_id";

const randomId = (prefix: string) => {
  const raw = crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${raw}`;
};

export const getEngagementSessionId = () => {
  if (typeof window === "undefined") return randomId("session");
  const existing = sessionStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const id = randomId("session");
  sessionStorage.setItem(SESSION_KEY, id);
  return id;
};

export const getEngagementVisitorId = () => {
  if (typeof window === "undefined") return randomId("visitor");
  const existing = localStorage.getItem(VISITOR_KEY);
  if (existing) return existing;
  const id = randomId("visitor");
  localStorage.setItem(VISITOR_KEY, id);
  return id;
};

const detectDeviceType = () => {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();
  if (/ipad|tablet/.test(ua)) return "tablet";
  if (/mobi|android|iphone/.test(ua)) return "mobile";
  return "desktop";
};

// Public write path. Anon has no RLS INSERT grant on
// customer_engagement_events, so the old direct .insert() silently
// dropped every event. record-engagement inserts via the service role
// and re-derives ip/device/geo authoritatively; the device hint below
// is advisory only. sendBeacon is preferred because it survives page
// unload (exit/last events), and neither transport is ever awaited in
// the UI path.
const ENGAGEMENT_ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/record-engagement`;

export const trackCustomerEngagement = async (payload: CustomerEngagementPayload) => {
  try {
    const event = {
      tenant_id: payload.tenantId || null,
      store_id: payload.storeId || null,
      vehicle_id: payload.vehicleId || null,
      vin: payload.vin || null,
      stock: payload.stock || null,
      session_id: payload.sessionId || getEngagementSessionId(),
      visitor_id: payload.visitorId || getEngagementVisitorId(),
      source: payload.source || "unknown",
      surface: payload.surface || "unknown",
      event_type: payload.eventType,
      document_type: payload.documentType || null,
      document_id: payload.documentId || null,
      document_title: payload.documentTitle || null,
      packet_id: payload.packetId || null,
      qr_token: payload.qrToken || null,
      referrer: typeof document !== "undefined" ? document.referrer || null : null,
      landing_url: typeof window !== "undefined" ? window.location.href : null,
      device_type: detectDeviceType(),
      metadata: payload.metadata || {},
    };
    const bodyText = JSON.stringify({ event });

    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      try {
        // Some browsers THROW on an oversized beacon rather than returning
        // false; catch it here so we fall through to the keepalive fetch
        // instead of losing the event to the outer catch.
        const ok = navigator.sendBeacon(ENGAGEMENT_ENDPOINT, new Blob([bodyText], { type: "application/json" }));
        if (ok) return;
      } catch { /* fall through to fetch */ }
    }
    // sendBeacon unavailable or queue full — fall back to keepalive fetch so
    // the request still completes if the page is unloading.
    void fetch(ENGAGEMENT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyText,
      keepalive: true,
    }).catch(() => {});
  } catch (err) {
    console.warn("Customer engagement event was not recorded", err);
  }
};

export const trackPassportOpened = (payload: Omit<CustomerEngagementPayload, "eventType" | "surface" | "source">) =>
  trackCustomerEngagement({ ...payload, eventType: "passport_opened", surface: "vehicle_passport", source: "passport" });

export const trackWindowStickerScanned = (payload: Omit<CustomerEngagementPayload, "eventType" | "surface" | "source">) =>
  trackCustomerEngagement({ ...payload, eventType: "window_sticker_scanned", surface: "window_sticker", source: "window_sticker_qr" });

export const trackPacketOpened = (payload: Omit<CustomerEngagementPayload, "eventType" | "surface">) =>
  trackCustomerEngagement({ ...payload, eventType: "packet_opened", surface: "document_packet" });

export const trackDocumentOpened = (payload: Omit<CustomerEngagementPayload, "eventType" | "surface">) =>
  trackCustomerEngagement({ ...payload, eventType: "document_opened", surface: "document_viewer" });

export const trackDocumentDownloaded = (payload: Omit<CustomerEngagementPayload, "eventType" | "surface">) =>
  trackCustomerEngagement({ ...payload, eventType: "document_downloaded", surface: "document_viewer" });

export const trackCustomerCtaClicked = (payload: Omit<CustomerEngagementPayload, "eventType">) =>
  trackCustomerEngagement({ ...payload, eventType: "cta_clicked" });

export const trackLeadSubmitted = (payload: Omit<CustomerEngagementPayload, "eventType" | "surface">) =>
  trackCustomerEngagement({ ...payload, eventType: "lead_submitted", surface: "lead_form" });
