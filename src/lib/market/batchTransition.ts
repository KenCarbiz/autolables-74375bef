// ── The inventory-wide market check, while it is being replaced ────────────
//
// The dealer-facing sentence lives here rather than inline so the button, its
// accessible description and its test cannot drift into saying three different
// things. It is a status, not an error: nothing is broken, and the dealer did
// nothing wrong.

export const MARKET_BATCH_NOTICE = "Automated market review is being prepared.";
