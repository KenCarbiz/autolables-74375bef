import { supabase } from "@/integrations/supabase/client";
import {
  getEngagementSessionId,
  getEngagementVisitorId,
  trackCustomerEngagement,
  trackCustomerCtaClicked,
  trackLeadSubmitted,
} from "@/lib/engagement/customerEngagement";

export type PassportDeliverySettings = {
  id?: string;
  tenant_id: string;
  enabled: boolean;
  require_customer_name: boolean;
  require_sms_verification: boolean;
  require_phone: boolean;
  create_lead: boolean;
  notify_sales_team: boolean;
  allow_trade_value_cta: boolean;
  autocurb_trade_enabled: boolean;
  autocurb_trade_url?: string | null;
  show_dealer_investment_report?: boolean;
  show_vehicle_health_report?: boolean;
  show_service_investment_card?: boolean;
  allow_service_qr_inspection_intake?: boolean;
  email_subject_template?: string | null;
  email_intro_template?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type PassportVehicleContext = {
  tenantId?: string | null;
  storeId?: string | null;
  vehicleId?: string | null;
  vin?: string | null;
  stock?: string | null;
  packetId?: string | null;
  qrToken?: string | null;
  vehicleOfInterest?: Record<string, unknown>;
};

export type PassportDocumentRequestInput = PassportVehicleContext & {
  customerName?: string | null;
  customerEmail: string;
  customerPhone?: string | null;
  requestedDocuments?: Array<{
    documentType: string;
    documentId?: string | null;
    documentTitle?: string | null;
  }>;
  customerTradeIntent?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type PassportDocumentRequestResult = {
  requestId: string;
  verificationRequired: boolean;
  verificationStatus: "not_required" | "pending" | "verified" | "failed" | "expired";
  deliveryStatus: "requested" | "queued" | "sent" | "failed" | "cancelled";
};

const defaultSettings = (tenantId: string): PassportDeliverySettings => ({
  tenant_id: tenantId,
  enabled: false,
  require_customer_name: true,
  require_sms_verification: false,
  require_phone: false,
  create_lead: true,
  notify_sales_team: true,
  allow_trade_value_cta: true,
  autocurb_trade_enabled: false,
  show_dealer_investment_report: false,
  show_vehicle_health_report: false,
  show_service_investment_card: false,
  allow_service_qr_inspection_intake: false,
});

export const loadPassportDeliverySettings = async (tenantId?: string | null) => {
  if (!tenantId) return null;
  const { data, error } = await (supabase as any)
    .from("passport_delivery_settings")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    console.warn("Could not load passport delivery settings", error);
    return defaultSettings(tenantId);
  }

  return ({ ...defaultSettings(tenantId), ...((data as PassportDeliverySettings | null) || {}) });
};

export const savePassportDeliverySettings = async (settings: PassportDeliverySettings) => {
  const { data, error } = await (supabase as any)
    .from("passport_delivery_settings")
    .upsert(settings, { onConflict: "tenant_id" })
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return data as PassportDeliverySettings;
};

export const requestPassportDocumentDelivery = async (input: PassportDocumentRequestInput): Promise<PassportDocumentRequestResult> => {
  const tenantId = input.tenantId || null;
  const settings = tenantId ? await loadPassportDeliverySettings(tenantId) : null;
  const verificationRequired = !!settings?.require_sms_verification;
  const phoneRequired = !!settings?.require_phone || verificationRequired;

  if (settings && !settings.enabled) throw new Error("Document delivery is not enabled for this dealer");
  if (settings?.require_customer_name && !input.customerName?.trim()) throw new Error("Customer name is required");
  if (phoneRequired && !input.customerPhone?.trim()) throw new Error("Mobile number is required");

  const sessionId = getEngagementSessionId();
  const visitorId = getEngagementVisitorId();
  const deliveryStatus = verificationRequired ? "requested" : "queued";
  const verificationStatus = verificationRequired ? "pending" : "not_required";

  await trackCustomerEngagement({
    tenantId,
    storeId: input.storeId,
    vehicleId: input.vehicleId,
    vin: input.vin,
    stock: input.stock,
    packetId: input.packetId,
    qrToken: input.qrToken,
    sessionId,
    visitorId,
    source: "passport",
    surface: "document_packet",
    eventType: "lead_form_opened",
    metadata: { request_type: "document_delivery", verificationRequired },
  });

  const { data, error } = await (supabase as any)
    .from("passport_document_delivery_requests")
    .insert({
      tenant_id: tenantId,
      store_id: input.storeId || null,
      vehicle_id: input.vehicleId || null,
      vin: input.vin || null,
      stock: input.stock || null,
      packet_id: input.packetId || null,
      qr_token: input.qrToken || null,
      customer_name: input.customerName || null,
      customer_email: input.customerEmail,
      customer_phone: input.customerPhone || null,
      verification_required: verificationRequired,
      verification_status: verificationStatus,
      delivery_status: deliveryStatus,
      lead_status: settings?.create_lead === false ? "suppressed" : "new",
      source: "passport",
      vehicle_of_interest: input.vehicleOfInterest || {},
      requested_documents: input.requestedDocuments || [],
      customer_trade_intent: input.customerTradeIntent || {},
      autocurb_handoff: buildAutoCurbHandoff(settings, input),
      session_id: sessionId,
      visitor_id: visitorId,
      referrer: typeof document !== "undefined" ? document.referrer || null : null,
      landing_url: typeof window !== "undefined" ? window.location.href : null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      metadata: input.metadata || {},
    })
    .select("id,verification_status,delivery_status")
    .maybeSingle();

  if (error) throw error;
  const requestId = data.id as string;

  await trackLeadSubmitted({
    tenantId,
    storeId: input.storeId,
    vehicleId: input.vehicleId,
    vin: input.vin,
    stock: input.stock,
    packetId: input.packetId,
    qrToken: input.qrToken,
    sessionId,
    visitorId,
    source: "passport",
    metadata: {
      request_id: requestId,
      lead_type: "passport_document_delivery",
      verificationRequired,
      has_phone: !!input.customerPhone,
      has_trade_intent: !!input.customerTradeIntent && Object.keys(input.customerTradeIntent).length > 0,
    },
  });

  if (verificationRequired) {
    await queuePassportSmsVerification(requestId, input.customerPhone || "", tenantId);
  } else {
    await queuePassportDocumentEmail(requestId, tenantId, input.customerEmail);
  }

  if (settings?.notify_sales_team) {
    await queuePassportSalesNotification(requestId, tenantId);
  }

  return {
    requestId,
    verificationRequired,
    verificationStatus: data.verification_status,
    deliveryStatus: data.delivery_status,
  };
};

const queuePassportSmsVerification = async (requestId: string, phone: string, tenantId?: string | null) => {
  const { error } = await (supabase as any).from("passport_document_delivery_outbox").insert({
    request_id: requestId,
    tenant_id: tenantId || null,
    channel: "sms",
    status: "queued",
    recipient: phone,
    payload: { purpose: "passport_document_delivery_verification" },
  });
  if (error) throw error;
};

export const queuePassportDocumentEmail = async (requestId: string, tenantId?: string | null, recipient?: string | null) => {
  const { error } = await (supabase as any).from("passport_document_delivery_outbox").insert({
    request_id: requestId,
    tenant_id: tenantId || null,
    channel: "email",
    status: "queued",
    recipient: recipient || null,
    payload: { purpose: "passport_document_delivery" },
  });
  if (error) throw error;
};

const queuePassportSalesNotification = async (requestId: string, tenantId?: string | null) => {
  const { error } = await (supabase as any).from("passport_document_delivery_outbox").insert({
    request_id: requestId,
    tenant_id: tenantId || null,
    channel: "sales_notification",
    status: "queued",
    payload: { purpose: "passport_document_delivery_sales_notification" },
  });
  if (error) throw error;
};

const buildAutoCurbHandoff = (settings: PassportDeliverySettings | null | undefined, input: PassportDocumentRequestInput) => {
  if (!settings?.autocurb_trade_enabled) return {};
  return {
    enabled: true,
    tradeUrl: settings.autocurb_trade_url || null,
    vehicle: {
      tenantId: input.tenantId,
      storeId: input.storeId,
      vehicleId: input.vehicleId,
      vin: input.vin,
      stock: input.stock,
      packetId: input.packetId,
      qrToken: input.qrToken,
      vehicleOfInterest: input.vehicleOfInterest || {},
    },
  };
};

export const trackPassportTradeValueClicked = async (vehicle: PassportVehicleContext) => {
  await trackCustomerCtaClicked({
    tenantId: vehicle.tenantId,
    storeId: vehicle.storeId,
    vehicleId: vehicle.vehicleId,
    vin: vehicle.vin,
    stock: vehicle.stock,
    packetId: vehicle.packetId,
    qrToken: vehicle.qrToken,
    source: "passport",
    surface: "vehicle_passport",
    metadata: { cta: "trade" },
  });
};
