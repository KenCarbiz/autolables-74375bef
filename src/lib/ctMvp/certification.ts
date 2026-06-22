import { canonicalVehicleToCtMvpInput, evaluateCtMvpRules, type CtMvpDealerPreferences, type CtMvpRuleOutput } from "./ruleEngine";
import type { CanonicalVehicle } from "@/lib/inventory/normalizeVehicle";
import { evaluateDocumentLifecycleAudit, requirementsFromCtOutputs, type DocumentLifecycleAudit, type DocumentLifecycleEvent } from "@/lib/audit/documentLifecycle";
import { ctMvpSignatureRequirementsForDocuments, validateSignatureWorkflow, type SignatureEvidence, type SignatureWorkflowValidation } from "@/lib/audit/signatureValidation";

export type CtMvpCertificationInput = {
  vehicle: CanonicalVehicle;
  dealerPreferences?: CtMvpDealerPreferences;
  lifecycleEvents?: DocumentLifecycleEvent[];
  signatureEvidence?: SignatureEvidence[];
};

export type CtMvpCertificationCheck = {
  key: string;
  label: string;
  status: "pass" | "fail" | "warning";
  detail: string;
};

export type CtMvpCertificationResult = {
  ready: boolean;
  vehicleTitle: string;
  ruleOutput: CtMvpRuleOutput;
  lifecycleAudit: DocumentLifecycleAudit;
  signatureValidation: SignatureWorkflowValidation;
  requiredDocumentKeys: string[];
  checks: CtMvpCertificationCheck[];
};

export function requiredDocumentKeysFromRuleOutput(ruleOutput: CtMvpRuleOutput): string[] {
  return [
    "window_sticker",
    "addendum",
    ruleOutput.ftcBuyersGuide === "required" ? "ftc_buyers_guide" : undefined,
    ruleOutput.k208 === "required" ? "k208" : undefined,
    ruleOutput.passportStatus === "enabled" ? "passport" : undefined,
  ].filter(Boolean) as string[];
}

export function certifyCtMvp(input: CtMvpCertificationInput): CtMvpCertificationResult {
  const vehicleInput = canonicalVehicleToCtMvpInput(input.vehicle, input.dealerPreferences);
  const ruleOutput = evaluateCtMvpRules(vehicleInput, input.dealerPreferences);
  const requiredDocumentKeys = requiredDocumentKeysFromRuleOutput(ruleOutput);
  const lifecycleAudit = evaluateDocumentLifecycleAudit(
    input.lifecycleEvents || [],
    requirementsFromCtOutputs(ruleOutput),
  );
  const signatureValidation = validateSignatureWorkflow(
    input.signatureEvidence || [],
    ctMvpSignatureRequirementsForDocuments(requiredDocumentKeys),
  );

  const checks: CtMvpCertificationCheck[] = [
    {
      key: "vehicle_normalized",
      label: "Vehicle normalized",
      status: input.vehicle.warnings.length === 0 ? "pass" : "warning",
      detail: input.vehicle.warnings.length ? input.vehicle.warnings.join(", ") : "Canonical vehicle has required core identifiers",
    },
    {
      key: "rules_evaluated",
      label: "Rules evaluated",
      status: "pass",
      detail: `${ruleOutput.selectedWindowSticker} / ${ruleOutput.selectedAddendum}`,
    },
    {
      key: "documents_required",
      label: "Required documents identified",
      status: requiredDocumentKeys.length > 0 ? "pass" : "fail",
      detail: requiredDocumentKeys.join(", ") || "No required document keys were produced",
    },
    {
      key: "lifecycle_complete",
      label: "Lifecycle audit complete",
      status: lifecycleAudit.complete ? "pass" : "fail",
      detail: lifecycleAudit.complete
        ? "All required lifecycle events are recorded"
        : `Missing: ${lifecycleAudit.missingRequired.map((item) => item.label).join(", ")}`,
    },
    {
      key: "signatures_complete",
      label: "Required signatures complete",
      status: signatureValidation.complete ? "pass" : "fail",
      detail: signatureValidation.complete
        ? "All required signatures are captured"
        : `Missing: ${signatureValidation.missingRequired.map((item) => item.label).join(", ")}`,
    },
    {
      key: "packet_ready",
      label: "Packet ready",
      status: signatureValidation.packetReady ? "pass" : "fail",
      detail: signatureValidation.packetReady ? "Signed packet can be assembled" : "Packet is blocked by missing signatures or acknowledgements",
    },
    {
      key: "archive_ready",
      label: "Archive ready",
      status: signatureValidation.archiveReady && lifecycleAudit.complete ? "pass" : "warning",
      detail: signatureValidation.archiveReady && lifecycleAudit.complete
        ? "Archive evidence is complete"
        : [...signatureValidation.evidenceWarnings, ...lifecycleAudit.missingRequired.map((item) => item.label)].join(", ") || "Archive requires final evidence review",
    },
  ];

  const ready = checks.every((check) => check.status === "pass");

  return {
    ready,
    vehicleTitle: input.vehicle.title,
    ruleOutput,
    lifecycleAudit,
    signatureValidation,
    requiredDocumentKeys,
    checks,
  };
}
