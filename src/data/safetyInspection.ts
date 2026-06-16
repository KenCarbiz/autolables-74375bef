// Single source of truth for per-state used-vehicle safety inspection forms.
// Used vehicles in these states require a safety inspection before retail
// delivery (CT's is the K-208); new vehicles never do. The inspection is a
// service-department, pre-delivery artifact — tracked in Get-Ready, not on
// the customer addendum.

export interface SafetyInspection {
  form: string;
  desc: string;
}

export const STATE_SAFETY_INSPECTION: Record<string, SafetyInspection> = {
  CT: { form: "K-208", desc: "Connecticut used-car safety inspection (Form K-208)." },
  NY: { form: "NY safety & emissions inspection", desc: "New York State inspection certificate (safety + anti-theft)." },
  PA: { form: "PA safety inspection", desc: "Pennsylvania safety inspection certificate." },
  NJ: { form: "NJ inspection", desc: "New Jersey inspection certificate." },
  TX: { form: "Texas vehicle inspection", desc: "Texas vehicle inspection report." },
  MA: { form: "MA safety inspection", desc: "Massachusetts safety/emissions inspection." },
  VA: { form: "VA safety inspection", desc: "Virginia safety inspection certificate." },
  ME: { form: "ME safety inspection", desc: "Maine safety inspection certificate." },
  RI: { form: "RI safety & emissions inspection", desc: "Rhode Island inspection certificate." },
  MO: { form: "MO safety inspection", desc: "Missouri safety inspection certificate." },
};

export const getStateSafetyInspection = (
  state: string | null | undefined,
): SafetyInspection | null => STATE_SAFETY_INSPECTION[(state || "").toUpperCase()] || null;

// Form name for a USED vehicle in a state; null for new vehicles or states
// without a named requirement.
export const usedSafetyInspectionForm = (
  state: string | null | undefined,
  condition: string | null | undefined,
): string | null => {
  if (condition === "new") return null;
  return getStateSafetyInspection(state)?.form || null;
};
