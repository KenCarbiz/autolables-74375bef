// Single resolver for "which state's rules govern this document". The
// per-rooftop store state wins (multi-store groups cross state lines),
// then the dealer's configured doc-fee state, then the profile state.
// Every compliance surface must resolve through this so the addendum,
// stickers, red-team, and Buyers Guide can never disagree on jurisdiction.
export const resolveOperatingState = (
  settings: { doc_fee_state?: string | null; dealer_state?: string | null },
  storeState?: string | null,
): string =>
  (storeState || settings.doc_fee_state || settings.dealer_state || "")
    .trim()
    .toUpperCase();
