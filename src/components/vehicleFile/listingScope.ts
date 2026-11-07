// Listing visibility and retail preparation are separate scopes (L05).
//
// What the server actually enforces (verified read-only against production on
// 2026-11-07, `enforce_prep_gate()` on vehicle_listings): a transition into
// `published` is refused only when recall_check.do_not_drive is true and no
// override is recorded; platform admins bypass. There is NO prep sign-off
// condition. `ingest_auto_publish` (default on) lists a vehicle on intake.
//
// So a foreman's prep sign-off records RETAIL PREPARATION. It does not unlock,
// gate or control the public listing, and no screen may say it does. This is
// wording only: the intended listing-on-intake policy is unchanged.

/** True when the store lists vehicles on intake (the default). */
export const listsOnIntake = (ingestAutoPublish: boolean | null | undefined): boolean => ingestAutoPublish !== false;

/** One line describing the vehicle's listing state and the policy behind it. */
export function listingScopeLine(status: string | null | undefined, ingestAutoPublish: boolean | null | undefined): string {
  const auto = listsOnIntake(ingestAutoPublish);
  const s = String(status ?? "").toLowerCase();
  if (s === "published") {
    return auto
      ? "Listed on the shopper portal. Your store lists vehicles on intake; get-ready and compliance work continues separately."
      : "Listed on the shopper portal. A person published it.";
  }
  if (s === "archived") return "Archived, not listed.";
  return auto
    ? "Not listed. Your store lists vehicles on intake, so this one was unpublished by a person or held by a do-not-drive recall."
    : "Not listed. Your store publishes each vehicle by hand.";
}

export interface PrepScopeCopy {
  title: string;
  summary: string;
  detail: string;
}

/** The Get Ready "listing vs. preparation" disclosure, worded from policy. */
export function prepScopeCopy(input: {
  published: boolean;
  prepSignedOff: boolean;
  ingestAutoPublish: boolean | null | undefined;
  foremanName?: string | null;
  signedAtLabel?: string | null;
}): PrepScopeCopy {
  const auto = listsOnIntake(input.ingestAutoPublish);
  const listing = input.published ? "Listed" : "Not listed";
  const prep = input.prepSignedOff ? "prep signed off" : "prep sign-off pending";
  const policy = auto
    ? "Your store lists vehicles on intake. Prep sign-off records that the vehicle was prepared for retail; it does not control the public listing."
    : "A person publishes each vehicle. Prep sign-off records that the vehicle was prepared for retail; publishing is a separate step.";
  const signed = input.prepSignedOff
    ? ` Foreman ${input.foremanName || "sign-off"} recorded ${input.signedAtLabel ?? "on file"}.`
    : "";
  return {
    title: "Listing and preparation",
    summary: `${listing} · ${prep}`,
    detail: `${policy} The only automatic publishing block is an unresolved do-not-drive recall.${signed}`,
  };
}
