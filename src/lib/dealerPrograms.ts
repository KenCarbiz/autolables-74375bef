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
// included = part of the sale (addendum Included Benefits); available = an
// optional upgrade the customer can add (addendum Available Upgrades).
export type ProgramMode = "included" | "available";

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
  mode?: ProgramMode;      // absent = "included" (pre-existing programs)
  price?: number | null;   // optional price shown when mode is "available"
  // Dealer-branded coverage (lifetime powertrain, dealer CPO, …). Warranty
  // programs can additionally surface in the passport's warranty panel.
  isWarranty?: boolean;
  coverage?: string;       // e.g. "Powertrain", "Dealer CPO", "Comprehensive"
  termYears?: number | null;
  termMiles?: number | null;
  lifetime?: boolean;
  showOnWarrantyPanel?: boolean;
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
  mode: "included",
  price: null,
  isWarranty: false,
  coverage: "",
  termYears: null,
  termMiles: null,
  lifetime: false,
  showOnWarrantyPanel: false,
});

// Common included-with-sale items a dealer can add in one click, pre-filled
// in the FTC value/offer/benefit/disclosure shape and then edited to match
// the store's real policy. Disclosures stay generic on purpose — the dealer
// owns the final wording.
export const PROGRAM_PRESETS: { key: string; label: string; fields: Partial<DealerProgram> & Pick<DealerProgram, "title" | "offer" | "benefit" | "disclosure"> }[] = [
  {
    key: "dealer-warranty", label: "Dealer Warranty",
    fields: {
      title: "Dealer Limited Powertrain Warranty",
      offer: "Included limited powertrain coverage on qualifying vehicles — engine, transmission, and drive components.",
      benefit: "Major repairs are covered after the sale, at no extra cost to you.",
      disclosure: "Coverage term, components, and eligibility vary by vehicle. See dealer for the written warranty, exclusions, and any deductible.",
      isWarranty: true, coverage: "Powertrain", showOnWarrantyPanel: true,
    },
  },
  {
    key: "lifetime-powertrain", label: "Lifetime Powertrain",
    fields: {
      title: "Lifetime Powertrain Limited Warranty",
      offer: "Dealer-added lifetime powertrain coverage on every qualifying new vehicle — engine, transmission, and drive components for as long as you own it.",
      benefit: "Coverage that never expires while you own the vehicle — protection the factory warranty can't match.",
      // 16 CFR 239.4: a "lifetime" claim must state the life it's measured by.
      disclosure: "\"Lifetime\" means for as long as the original purchaser owns this vehicle; coverage ends on sale, trade, or transfer. Requires documented factory-scheduled maintenance. The full written limited warranty, including exclusions and any deductible, is available for your review before purchase.",
      appliesTo: "new", isWarranty: true, coverage: "Powertrain", lifetime: true,
      showOnWarrantyPanel: true, showOnSticker: true,
    },
  },
  {
    key: "dealer-cpo", label: "Dealer Pre-Owned Warranty",
    // Deliberately NOT titled "Certified": several states (CA Veh. Code
    // 11713.18 among them) restrict advertising a used car as certified.
    // Dealers who run a true certification program can rename it themselves.
    fields: {
      title: "Dealer-Backed Pre-Owned Limited Warranty",
      offer: "Our own pre-owned coverage — 10-year / 100,000-mile powertrain protection on qualifying pre-owned vehicles, backed by this dealership.",
      benefit: "Long-term coverage on a pre-owned vehicle, backed by this dealership.",
      disclosure: "Measured from the vehicle's original in-service date. Eligibility, covered components, and deductible are defined in the written limited warranty, available for your review before purchase. This is a dealer program, not a manufacturer certified pre-owned program.",
      appliesTo: "used", isWarranty: true, coverage: "Dealer Powertrain",
      termYears: 10, termMiles: 100000, showOnWarrantyPanel: true,
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

// "used" subsumes "cpo": a dealer's used-car program (e.g. dealer CPO
// coverage) is meant for certified cars too — matching strictly would hide
// the program on exactly the cars it targets. Missing appliesTo = all, the
// same default the server applies. Mirror any change here in
// public-listing-view's applies().
const matchesCondition = (appliesTo: ProgramAppliesTo | undefined, condition: string | null | undefined): boolean => {
  if (!appliesTo || appliesTo === "all") return true;
  const c = (condition || "").toLowerCase();
  if (appliesTo === "used") return c === "used" || c === "cpo";
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

// Absent mode means "included" — programs predate the field.
export const programMode = (p: DealerProgram): ProgramMode => (p.mode === "available" ? "available" : "included");

// "Lifetime", "10-Year / 100,000-Mile", "5-Year", "60,000-Mile", or null.
export function termLabel(p: DealerProgram): string | null {
  if (p.lifetime) return "Lifetime";
  const y = p.termYears && p.termYears > 0 ? `${p.termYears}-Year` : null;
  const m = p.termMiles && p.termMiles > 0 ? `${p.termMiles.toLocaleString()}-Mile` : null;
  if (y && m) return `${y} / ${m}`;
  return y || m;
}

// Dealer-branded coverage rows for the passport warranty panel.
export function warrantyPanelPrograms(
  programs: DealerProgram[] | null | undefined,
  condition: string | null | undefined
): DealerProgram[] {
  return (programs || []).filter(
    (p) =>
      p.enabled &&
      p.isWarranty === true &&
      p.showOnWarrantyPanel === true &&
      (p.title.trim() || p.offer.trim()) &&
      matchesCondition(p.appliesTo, condition)
  );
}

// Dealer warranties INCLUDED with the sale and advertised on any customer
// surface. When one applies, the FTC Buyers Guide cannot honestly say
// "As-Is — No Dealer Warranty" (16 CFR 455: statements elsewhere may not
// contradict the Guide, and the Guide controls).
export function includedWarrantyPrograms(
  programs: DealerProgram[] | null | undefined,
  condition: string | null | undefined
): DealerProgram[] {
  return (programs || []).filter(
    (p) =>
      p.enabled &&
      p.isWarranty === true &&
      programMode(p) === "included" &&
      (p.showOnSticker || p.showOnPacket || p.showOnWarrantyPanel === true) &&
      (p.title.trim() || p.offer.trim()) &&
      matchesCondition(p.appliesTo, condition)
  );
}
