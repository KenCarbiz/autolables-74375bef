// Connecticut K-208 workflow model.
// This is the workflow shell for used vehicles sold in Connecticut where a K-208-style
// used vehicle warranty/service sign-off form is required. The exact official form fields,
// wording, retention requirements, and signature rules must be verified before production.

export type K208WorkflowRole =
  | "service_manager"
  | "service_writer"
  | "technician"
  | "used_car_manager"
  | "sales_manager"
  | "customer";

export type K208ChecklistStatus = "not_started" | "checked" | "not_applicable" | "needs_attention";

export type K208SignatureStatus = "pending" | "signed" | "declined" | "voided";

export type K208ChecklistItem = {
  id: string;
  label: string;
  description?: string;
  status: K208ChecklistStatus;
  required: boolean;
  completedBy?: string;
  completedByRole?: K208WorkflowRole;
  completedAt?: string;
  notes?: string;
};

export type K208Signature = {
  id: string;
  signerName?: string;
  signerRole: K208WorkflowRole;
  status: K208SignatureStatus;
  signedAt?: string;
  ipAddress?: string;
  userAgent?: string;
  signatureAssetUrl?: string;
};

export type ConnecticutK208Record = {
  id: string;
  dealerId: string;
  vehicleId: string;
  vin: string;
  stock?: string;
  modelYear: number;
  make: string;
  model: string;
  mileage?: number;
  saleState: "CT";
  warrantyDisposition: "as_is_no_dealer_warranty" | "state_required_warranty" | "limited_warranty" | "full_warranty";
  warrantyTermLabel?: string;
  checklist: K208ChecklistItem[];
  serviceSignature: K208Signature;
  customerSignature: K208Signature;
  locked: boolean;
  formVersion: string;
  createdAt: string;
  updatedAt: string;
  auditEventIds: string[];
};

export const DEFAULT_CT_K208_CHECKLIST: K208ChecklistItem[] = [
  {
    id: "vehicle-identified",
    label: "Vehicle identified",
    description: "VIN, stock number, year, make, model, and mileage reviewed.",
    status: "not_started",
    required: true,
  },
  {
    id: "repair-order-reviewed",
    label: "Repair order reviewed",
    description: "Open service ticket or repair order reviewed before closing/signoff.",
    status: "not_started",
    required: true,
  },
  {
    id: "safety-items-reviewed",
    label: "Safety-related items reviewed",
    description: "Service department reviewed applicable safety-related items and notes.",
    status: "not_started",
    required: true,
  },
  {
    id: "warranty-status-confirmed",
    label: "Warranty status confirmed",
    description: "As-is, state-required warranty, limited warranty, or full warranty status confirmed for the vehicle.",
    status: "not_started",
    required: true,
  },
  {
    id: "k208-ready-for-customer",
    label: "K-208 ready for customer signature",
    description: "Service signoff complete and form is ready for customer review/signature.",
    status: "not_started",
    required: true,
  },
];

export const createConnecticutK208Record = (input: {
  dealerId: string;
  vehicleId: string;
  vin: string;
  stock?: string;
  modelYear: number;
  make: string;
  model: string;
  mileage?: number;
  warrantyDisposition: ConnecticutK208Record["warrantyDisposition"];
  warrantyTermLabel?: string;
}): ConnecticutK208Record => {
  const now = new Date().toISOString();
  return {
    id: `ct-k208-${input.vin}-${Date.now()}`,
    dealerId: input.dealerId,
    vehicleId: input.vehicleId,
    vin: input.vin,
    stock: input.stock,
    modelYear: input.modelYear,
    make: input.make,
    model: input.model,
    mileage: input.mileage,
    saleState: "CT",
    warrantyDisposition: input.warrantyDisposition,
    warrantyTermLabel: input.warrantyTermLabel,
    checklist: DEFAULT_CT_K208_CHECKLIST.map((item) => ({ ...item })),
    serviceSignature: {
      id: `service-signature-${input.vin}`,
      signerRole: "service_manager",
      status: "pending",
    },
    customerSignature: {
      id: `customer-signature-${input.vin}`,
      signerRole: "customer",
      status: "pending",
    },
    locked: false,
    formVersion: "ct-k208-draft-v1-pending-official-verification",
    createdAt: now,
    updatedAt: now,
    auditEventIds: [],
  };
};

export const canServiceSignK208 = (record: ConnecticutK208Record) =>
  record.checklist.every((item) => !item.required || item.status === "checked" || item.status === "not_applicable");

export const canCustomerSignK208 = (record: ConnecticutK208Record) =>
  record.serviceSignature.status === "signed" && canServiceSignK208(record);

export const updateK208ChecklistItem = (
  record: ConnecticutK208Record,
  itemId: string,
  update: Partial<Pick<K208ChecklistItem, "status" | "notes" | "completedBy" | "completedByRole">>,
): ConnecticutK208Record => ({
  ...record,
  checklist: record.checklist.map((item) => item.id === itemId
    ? { ...item, ...update, completedAt: update.status === "checked" || update.status === "not_applicable" ? new Date().toISOString() : item.completedAt }
    : item),
  updatedAt: new Date().toISOString(),
});

export const signK208Service = (
  record: ConnecticutK208Record,
  signature: Omit<K208Signature, "id" | "signerRole" | "status" | "signedAt"> & { signerRole?: Exclude<K208WorkflowRole, "customer"> },
): ConnecticutK208Record => {
  if (!canServiceSignK208(record)) {
    return record;
  }

  return {
    ...record,
    serviceSignature: {
      ...record.serviceSignature,
      ...signature,
      signerRole: signature.signerRole || record.serviceSignature.signerRole,
      status: "signed",
      signedAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };
};

export const signK208Customer = (
  record: ConnecticutK208Record,
  signature: Omit<K208Signature, "id" | "signerRole" | "status" | "signedAt">,
): ConnecticutK208Record => {
  if (!canCustomerSignK208(record)) {
    return record;
  }

  return {
    ...record,
    customerSignature: {
      ...record.customerSignature,
      ...signature,
      signerRole: "customer",
      status: "signed",
      signedAt: new Date().toISOString(),
    },
    locked: true,
    updatedAt: new Date().toISOString(),
  };
};

export const CONNECTICUT_K208_WORKFLOW_NOTES = [
  "K-208 should be generated for Connecticut used vehicles as part of the used-vehicle compliance packet.",
  "Service must complete checklist items before service signoff is available.",
  "Service signoff may be completed by service manager, service writer, technician, used car manager, or another approved service user depending on dealer permissions.",
  "Customer signature should be blocked until service signoff is complete.",
  "Once customer signs, the K-208 record should lock and write an audit event.",
  "Official K-208 form fields and legal language must be verified before production rendering.",
];
