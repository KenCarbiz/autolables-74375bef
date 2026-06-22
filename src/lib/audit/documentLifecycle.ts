export type DocumentLifecycleEventType =
  | "vehicle_normalized"
  | "window_sticker_generated"
  | "addendum_generated"
  | "ftc_buyers_guide_generated"
  | "k208_generated"
  | "passport_generated"
  | "passport_viewed"
  | "customer_signed"
  | "deal_delivered"
  | "document_archived";

export type DocumentLifecycleEvent = {
  type: DocumentLifecycleEventType;
  occurredAt: string;
  actor?: string;
  source?: string;
  metadata?: Record<string, unknown>;
};

export type DocumentLifecycleRequirements = {
  requireWindowSticker?: boolean;
  requireAddendum?: boolean;
  requireFtcBuyersGuide?: boolean;
  requireK208?: boolean;
  requirePassport?: boolean;
  requirePassportView?: boolean;
  requireCustomerSignature?: boolean;
  requireDelivery?: boolean;
  requireArchive?: boolean;
};

export type DocumentLifecycleAuditItem = {
  key: DocumentLifecycleEventType;
  label: string;
  required: boolean;
  status: "complete" | "missing" | "not_required";
  occurredAt?: string;
  actor?: string;
  detail: string;
};

export type DocumentLifecycleAudit = {
  complete: boolean;
  missingRequired: DocumentLifecycleAuditItem[];
  items: DocumentLifecycleAuditItem[];
};

const LABELS: Record<DocumentLifecycleEventType, string> = {
  vehicle_normalized: "Vehicle normalized",
  window_sticker_generated: "Window sticker generated",
  addendum_generated: "Addendum generated",
  ftc_buyers_guide_generated: "FTC Buyers Guide generated",
  k208_generated: "K208 generated",
  passport_generated: "Vehicle Passport generated",
  passport_viewed: "Vehicle Passport viewed",
  customer_signed: "Customer signed",
  deal_delivered: "Deal delivered",
  document_archived: "Document archived",
};

const requirementMap: Array<{ key: DocumentLifecycleEventType; flag: keyof DocumentLifecycleRequirements; defaultRequired: boolean }> = [
  { key: "vehicle_normalized", flag: "requireWindowSticker", defaultRequired: true },
  { key: "window_sticker_generated", flag: "requireWindowSticker", defaultRequired: true },
  { key: "addendum_generated", flag: "requireAddendum", defaultRequired: true },
  { key: "ftc_buyers_guide_generated", flag: "requireFtcBuyersGuide", defaultRequired: true },
  { key: "k208_generated", flag: "requireK208", defaultRequired: true },
  { key: "passport_generated", flag: "requirePassport", defaultRequired: true },
  { key: "passport_viewed", flag: "requirePassportView", defaultRequired: false },
  { key: "customer_signed", flag: "requireCustomerSignature", defaultRequired: true },
  { key: "deal_delivered", flag: "requireDelivery", defaultRequired: true },
  { key: "document_archived", flag: "requireArchive", defaultRequired: true },
];

const latestEvent = (events: DocumentLifecycleEvent[], type: DocumentLifecycleEventType) =>
  events
    .filter((event) => event.type === type)
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))[0];

export function evaluateDocumentLifecycleAudit(
  events: DocumentLifecycleEvent[],
  requirements: DocumentLifecycleRequirements = {},
): DocumentLifecycleAudit {
  const items = requirementMap.map(({ key, flag, defaultRequired }) => {
    const required = requirements[flag] ?? defaultRequired;
    const event = latestEvent(events, key);
    const status: DocumentLifecycleAuditItem["status"] = !required ? "not_required" : event ? "complete" : "missing";
    return {
      key,
      label: LABELS[key],
      required,
      status,
      occurredAt: event?.occurredAt,
      actor: event?.actor,
      detail: !required
        ? "Not required for this deal configuration"
        : event
          ? `Recorded${event.source ? ` from ${event.source}` : ""}`
          : "Required event has not been recorded",
    };
  });

  const missingRequired = items.filter((item) => item.required && item.status === "missing");
  return {
    complete: missingRequired.length === 0,
    missingRequired,
    items,
  };
}

export function requirementsFromCtOutputs(outputs: {
  ftcBuyersGuide: "required" | "not_required";
  k208: "required" | "not_required";
  passportStatus: "enabled" | "disabled";
}): DocumentLifecycleRequirements {
  return {
    requireWindowSticker: true,
    requireAddendum: true,
    requireFtcBuyersGuide: outputs.ftcBuyersGuide === "required",
    requireK208: outputs.k208 === "required",
    requirePassport: outputs.passportStatus === "enabled",
    requirePassportView: false,
    requireCustomerSignature: true,
    requireDelivery: true,
    requireArchive: true,
  };
}
