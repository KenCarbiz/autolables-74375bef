import {
  VENDOR_PLACEHOLDER_NAME,
  vendorsFor,
  type GetReadyItem,
} from "@/hooks/useGetReady";
import { humanize } from "./format";

// ──────────────────────────────────────────────────────────────────────
// ONE VENDOR SET, and one identity for the vendors in it.
//
// Three rounds of fixes kept the two halves apart in a new place each time.
// What the manager is SHOWN under Vendor Assignments and what
// authorizeAndDispatch EMAILS must be the same set, so this module builds it
// once from ALL the get-ready lines — the same array deriveGetReadyDispatch
// reads — and the column layout never narrows it. Which column a line is
// DISPLAYED in (columnFor) and whether the line is third-party work
// (isThirdPartyItem) are not co-extensive: a service line that retains a
// vendorEmail after the department select is switched back displays under
// Service and is emailed as a vendor.
//
// Identity is the second half. The get-ready record identifies a vendor by
// vendorEmail (StartGetReadyModal collects no vendorName for accessories or
// services); the proof they upload identifies them by provider_company plus the
// "Contact number / email" they type into provider_contact (GetReady.tsx:472).
// provider_contact is therefore the ONLY value both sides can carry, and
// matching on provider_company alone meant an email-only vendor could never be
// proven — Pending Proof, then Overdue, over photographed work — and was listed
// a second time under their company name.
//
// Where nothing links them, they stay two rows and the assigned one stays
// unproven. That under-claims, which is the safe direction: it never reports
// proof that was not shown.
// ──────────────────────────────────────────────────────────────────────

const norm = (v: unknown): string => String(v ?? "").trim().toLowerCase();

export interface ThirdPartySignoff {
  is_third_party?: boolean | null;
  provider_company?: string | null;
  provider_contact?: string | null;
  photos?: unknown;
  status?: string | null;
}

export interface VendorAssignment {
  name: string;
  category: string;
  email: string | null;
  /** Lower-cased values this vendor can be recognised by, on either side. */
  keys: string[];
  /** This vendor has signed off with at least one photo of the work. */
  proven: boolean;
}

/** A third-party sign-off only counts as proof when it carries a photo. */
const hasProof = (s: ThirdPartySignoff): boolean =>
  String(s.status || "") === "signed" && Array.isArray(s.photos) && s.photos.length > 0;

const signoffKeys = (s: ThirdPartySignoff): string[] =>
  [norm(s.provider_company), norm(s.provider_contact)].filter(Boolean);

export function buildVendorAssignments(
  items: GetReadyItem[],
  signoffs: ThirdPartySignoff[],
): VendorAssignment[] {
  const thirdParty = signoffs.filter((s) => s.is_third_party !== false);
  const claimed = new Set<ThirdPartySignoff>();

  const assigned: VendorAssignment[] = vendorsFor(items).map((vd) => {
    // The placeholder is not a company name, so it must not match one.
    const keys = [norm(vd.email), vd.name === VENDOR_PLACEHOLDER_NAME ? "" : norm(vd.name)]
      .filter(Boolean);
    const matches = thirdParty.filter((s) => signoffKeys(s).some((k) => keys.includes(k)));
    for (const m of matches) claimed.add(m);
    const named = matches.find((s) => String(s.provider_company || "").trim());
    return {
      name: vd.name === VENDOR_PLACEHOLDER_NAME && named
        ? String(named.provider_company).trim()
        : vd.name,
      category: humanize(vd.category),
      email: vd.email,
      keys,
      proven: matches.some(hasProof),
    };
  });

  // A third party who signed off without ever being assigned a work item is
  // still on the vehicle and still owes the evidence packet a name.
  const extra: VendorAssignment[] = [];
  for (const s of thirdParty) {
    if (claimed.has(s)) continue;
    const name = String(s.provider_company || "").trim();
    if (!name) continue;
    const key = norm(name);
    if (assigned.some((a) => a.keys.includes(key)) || extra.some((a) => a.keys.includes(key))) continue;
    extra.push({
      name, category: "Third-party detail", email: null,
      keys: signoffKeys(s), proven: hasProof(s),
    });
  }

  return [...assigned, ...extra];
}

/** The assignment a get-ready line belongs to, by the identity the line carries. */
export function assignmentForItem(
  assignments: VendorAssignment[],
  item: GetReadyItem,
): VendorAssignment | null {
  const keys = [norm(item.vendorEmail), norm(item.vendorName)].filter(Boolean);
  if (keys.length === 0) return null;
  return assignments.find((a) => a.keys.some((k) => keys.includes(k))) ?? null;
}
