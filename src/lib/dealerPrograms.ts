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
