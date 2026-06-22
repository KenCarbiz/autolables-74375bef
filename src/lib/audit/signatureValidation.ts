export type SignatureRole = "customer" | "dealer" | "installer" | "manager";

export type SignatureEvidence = {
  role: SignatureRole;
  signerName?: string;
  signerEmail?: string;
  signedAt?: string;
  ipAddress?: string;
  userAgent?: string;
  deviceLabel?: string;
  signatureImageUrl?: string;
  consentText?: string;
  documentKeys?: string[];
};

export type SignatureValidationRequirement = {
  role: SignatureRole;
  label: string;
  required: boolean;
  requiredDocumentKeys?: string[];
};

export type SignatureValidationItem = {
  role: SignatureRole;
  label: string;
  required: boolean;
  status: "complete" | "missing" | "not_required";
  signedAt?: string;
  signerName?: string;
  detail: string;
};

export type SignatureWorkflowValidation = {
  complete: boolean;
  packetReady: boolean;
  archiveReady: boolean;
  missingRequired: SignatureValidationItem[];
  items: SignatureValidationItem[];
  evidenceWarnings: string[];
};

export const CT_MVP_SIGNATURE_REQUIREMENTS: SignatureValidationRequirement[] = [
  { role: "customer", label: "Customer signature", required: true },
  { role: "dealer", label: "Dealer representative signature", required: true },
  { role: "installer", label: "Installer proof/signature", required: false },
  { role: "manager", label: "Manager approval", required: false },
];

const latestByRole = (evidence: SignatureEvidence[], role: SignatureRole) =>
  evidence
    .filter((item) => item.role === role)
    .sort((a, b) => Date.parse(b.signedAt || "") - Date.parse(a.signedAt || ""))[0];

const missingDocs = (requiredKeys: string[] = [], actualKeys: string[] = []) =>
  requiredKeys.filter((key) => !actualKeys.includes(key));

export function validateSignatureWorkflow(
  evidence: SignatureEvidence[],
  requirements: SignatureValidationRequirement[] = CT_MVP_SIGNATURE_REQUIREMENTS,
): SignatureWorkflowValidation {
  const evidenceWarnings: string[] = [];

  const items = requirements.map((requirement) => {
    const signature = latestByRole(evidence, requirement.role);
    const missingDocumentKeys = missingDocs(requirement.requiredDocumentKeys, signature?.documentKeys);
    const hasRequiredDocs = missingDocumentKeys.length === 0;
    const isComplete = !!signature?.signedAt && hasRequiredDocs;
    const status: SignatureValidationItem["status"] = !requirement.required ? "not_required" : isComplete ? "complete" : "missing";

    if (signature?.signedAt && !signature.ipAddress) evidenceWarnings.push(`${requirement.label}: missing IP address evidence`);
    if (signature?.signedAt && !signature.userAgent) evidenceWarnings.push(`${requirement.label}: missing user-agent/device evidence`);
    if (signature?.signedAt && !signature.consentText) evidenceWarnings.push(`${requirement.label}: missing consent text snapshot`);

    return {
      role: requirement.role,
      label: requirement.label,
      required: requirement.required,
      status,
      signedAt: signature?.signedAt,
      signerName: signature?.signerName,
      detail: !requirement.required
        ? signature?.signedAt
          ? "Optional signature captured"
          : "Optional signature not required"
        : !signature?.signedAt
          ? "Required signature has not been captured"
          : !hasRequiredDocs
            ? `Signature captured, missing document acknowledgement: ${missingDocumentKeys.join(", ")}`
            : "Signature captured with required evidence",
    };
  });

  const missingRequired = items.filter((item) => item.required && item.status === "missing");
  const complete = missingRequired.length === 0;
  const packetReady = complete;
  const archiveReady = complete && evidenceWarnings.length === 0;

  return {
    complete,
    packetReady,
    archiveReady,
    missingRequired,
    items,
    evidenceWarnings,
  };
}

export function ctMvpSignatureRequirementsForDocuments(documentKeys: string[]): SignatureValidationRequirement[] {
  return [
    {
      role: "customer",
      label: "Customer signature",
      required: true,
      requiredDocumentKeys: documentKeys,
    },
    {
      role: "dealer",
      label: "Dealer representative signature",
      required: true,
      requiredDocumentKeys: documentKeys,
    },
    {
      role: "installer",
      label: "Installer proof/signature",
      required: documentKeys.includes("addendum"),
      requiredDocumentKeys: documentKeys.includes("addendum") ? ["addendum"] : [],
    },
    {
      role: "manager",
      label: "Manager approval",
      required: false,
    },
  ];
}
