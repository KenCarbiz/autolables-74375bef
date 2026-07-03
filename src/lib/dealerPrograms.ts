// ──────────────────────────────────────────────────────────────────────
// Dealer programs — tenant-level value propositions the dealer applies to
// every vehicle (e.g. "10-Year / 100,000-Mile Powertrain", "Lifetime
// Powertrain", "Free Maintenance"). Modeled on the FTC's expectation for an
// add-on/benefit claim: state the VALUE, the OFFER (what's included), the
// BENEFIT to the customer, and a DISCLOSURE (stipulations) — especially for
// open-ended claims like a lifetime powertrain. Programs can be gated on a
// requirement (e.g. must finance) and placed on the sticker, the customer
// packet, or both.
// ──────────────────────────────────────────────────────────────────────

export type ProgramAppliesTo = "all" | "new" | "used" | "cpo";
export type ProgramRequirement = "none" | "finance" | "custom";

export interface DealerProgram {
  id: string;
  enabled: boolean;
  title: string;          // VALUE — the headline claim
  offer: string;          // OFFER — what the customer actually gets
  benefit: string;        // BENEFIT — why it matters to the customer
  disclosure: string;     // DISCLOSURE — stipulations / disclaimer
  appliesTo: ProgramAppliesTo;
  requirement: ProgramRequirement;
  requirementText: string; // detail shown for finance / custom requirements
  showOnSticker: boolean;
  showOnPacket: boolean;
}

export const emptyProgram = (): DealerProgram => ({
  id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `prog-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  enabled: true,
  title: "",
  offer: "",
  benefit: "",
  disclosure: "",
  appliesTo: "all",
  requirement: "none",
  requirementText: "",
  showOnSticker: false,
  showOnPacket: true,
});

// Common included-with-sale items a dealer can add in one click, pre-filled
// in the FTC value/offer/benefit/disclosure shape and then edited to match
// the store's real policy. Disclosures stay generic on purpose — the dealer
// owns the final wording.
export const PROGRAM_PRESETS: { key: string; label: string; fields: Pick<DealerProgram, "title" | "offer" | "benefit" | "disclosure"> }[] = [
  {
    key: "dealer-warranty", label: "Dealer Warranty",
    fields: {
      title: "Dealer Limited Powertrain Warranty",
      offer: "Included limited powertrain coverage on qualifying vehicles — engine, transmission, and drive components.",
      benefit: "Major repairs are covered after the sale, at no extra cost to you.",
      disclosure: "Coverage term, components, and eligibility vary by vehicle. See dealer for the written warranty, exclusions, and any deductible.",
    },
  },
  {
    key: "loaner-vehicles", label: "Loaner Vehicles",
    fields: {
      title: "Free Loaner Vehicles",
      offer: "A loaner vehicle while your vehicle is in for covered service or repairs.",
      benefit: "Keep your day moving while we take care of your vehicle.",
      disclosure: "Subject to availability; scheduled in advance through our service department. Driver eligibility requirements apply.",
    },
  },
  {
    key: "maintenance", label: "Scheduled Maintenance",
    fields: {
      title: "Scheduled Maintenance Plan",
      offer: "Factory-scheduled maintenance included for the stated term.",
      benefit: "Lower cost of ownership with service by factory-trained technicians.",
      disclosure: "Term and covered services are defined in the plan document. See dealer for details.",
    },
  },
  {
    key: "car-washes", label: "Car Washes",
    fields: {
      title: "Free Car Washes",
      offer: "Complimentary car washes for as long as you own the vehicle.",
      benefit: "Keep your vehicle looking its best at no cost.",
      disclosure: "Available during normal business hours at this location.",
    },
  },
  {
    key: "inspections", label: "State Inspections",
    fields: {
      title: "Free State Inspections",
      offer: "State safety inspections included while you own the vehicle.",
      benefit: "One less recurring cost of ownership.",
      disclosure: "Performed at this location; excludes repairs required to pass inspection.",
    },
  },
  {
    key: "roadside", label: "Roadside Assistance",
    fields: {
      title: "24/7 Roadside Assistance",
      offer: "Towing, jump start, lockout, and flat-tire assistance around the clock.",
      benefit: "Help is a phone call away, wherever you are.",
      disclosure: "Provided per the program terms; service limits apply. See dealer for the program document.",
    },
  },
  {
    key: "exchange", label: "Exchange Policy",
    fields: {
      title: "Vehicle Exchange Policy",
      offer: "Exchange the vehicle within the stated time and mileage window if it isn't the right fit.",
      benefit: "Buy with confidence knowing you have options.",
      disclosure: "Exchange window, mileage cap, and vehicle-condition requirements apply. See dealer for the written policy.",
    },
  },
  {
    key: "history-report", label: "History Report",
    fields: {
      title: "Free Vehicle History Report",
      offer: "A third-party vehicle history report included with every pre-owned vehicle.",
      benefit: "Know the vehicle's past before you buy.",
      disclosure: "Report content is provided by its third-party publisher.",
    },
  },
];

export const presetProgram = (key: string): DealerProgram | null => {
  const preset = PROGRAM_PRESETS.find((p) => p.key === key);
  return preset ? { ...emptyProgram(), ...preset.fields } : null;
};

const matchesCondition = (appliesTo: ProgramAppliesTo, condition: string | null | undefined): boolean => {
  if (appliesTo === "all") return true;
  const c = (condition || "").toLowerCase();
  return appliesTo === c;
};

// Programs that should appear for a given vehicle + placement.
export function applicablePrograms(
  programs: DealerProgram[] | null | undefined,
  condition: string | null | undefined,
  placement: "sticker" | "packet"
): DealerProgram[] {
  return (programs || []).filter(
    (p) =>
      p.enabled &&
      (p.title.trim() || p.offer.trim()) &&
      matchesCondition(p.appliesTo, condition) &&
      (placement === "sticker" ? p.showOnSticker : p.showOnPacket)
  );
}

// Short human-readable requirement label (used as a badge).
export function requirementLabel(p: DealerProgram): string | null {
  if (p.requirement === "none") return null;
  if (p.requirement === "finance") return p.requirementText.trim() || "With dealer financing";
  return p.requirementText.trim() || "Conditions apply";
}
