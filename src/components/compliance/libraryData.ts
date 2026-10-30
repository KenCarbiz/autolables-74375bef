import { getStateCompliance, type StateCompliance } from "@/data/stateCompliance";

// The Library is a source-backed reference table, not legal advice. Law rows
// cite their authority; dealer-policy and product-check rows say which
// AutoLabels behavior they describe. A review date is shown only when one is
// recorded, which none are yet, so it reads "Not recorded" rather than a guess.

export type LibraryType = "Law" | "Dealer policy" | "Product check";

export interface LibraryRow {
  id: string;
  jurisdiction: string;
  requirement: string;
  type: LibraryType;
  source: string;
  sourceUrl: string | null;
  reviewed: string | null;
  workflow: string;
  summary: string;
  requirements: string[];
  applies: string;
  effective: string | null;
}

const row = (r: Omit<LibraryRow, "reviewed" | "sourceUrl" | "effective"> & Partial<Pick<LibraryRow, "reviewed" | "sourceUrl" | "effective">>): LibraryRow => ({
  reviewed: null,
  sourceUrl: null,
  effective: null,
  ...r,
});

export const FEDERAL_AND_PRODUCT_ROWS: LibraryRow[] = [
  row({
    id: "fed-buyers-guide",
    jurisdiction: "Federal",
    requirement: "Used Vehicle Buyers Guide",
    type: "Law",
    source: "16 CFR Part 455 (Used Car Rule)",
    sourceUrl: "https://www.ecfr.gov/current/title-16/chapter-I/subchapter-D/part-455",
    workflow: "Vehicle Documents",
    summary: "A dealer that sells five or more used vehicles in a twelve-month period must display a Buyers Guide on each used vehicle offered for sale.",
    requirements: [
      "Display the Buyers Guide on every used vehicle offered for sale",
      "State the warranty position: As Is, implied warranties only, or a dealer warranty",
      "List covered systems when a warranty is offered",
      "Carry the required wording from the rule, including the inspection and written-promises statements",
      "Provide a Spanish version when the sale is conducted in Spanish",
    ],
    applies: "Vehicle Documents, FTC Buyers Guide generator. AutoLabels produces an FTC-aligned form; confirm it against the rule text before use.",
  }),
  row({
    id: "fed-monroney",
    jurisdiction: "Federal",
    requirement: "Monroney label on new vehicles",
    type: "Law",
    source: "Automobile Information Disclosure Act, 15 U.S.C. 1231-1233",
    sourceUrl: "https://www.law.cornell.edu/uscode/text/15/1232",
    workflow: "Factory Build Record",
    summary: "The manufacturer label must stay on a new vehicle until it is delivered to the customer. The dealer addendum is a separate document beside it.",
    requirements: [
      "Do not remove or alter the manufacturer label before delivery",
      "Keep dealer-added equipment on a separate addendum with its own pricing",
    ],
    applies: "New-car sticker and addendum, Factory Build Record.",
  }),
  row({
    id: "fed-ftc-act",
    jurisdiction: "Federal",
    requirement: "Unfair or deceptive pricing and add-on practices",
    type: "Law",
    source: "FTC Act Section 5, 15 U.S.C. 45",
    sourceUrl: "https://www.law.cornell.edu/uscode/text/15/45",
    workflow: "Price integrity",
    summary: "Section 5 prohibits unfair or deceptive acts or practices, including misleading advertised prices and add-ons charged without the customer's informed consent.",
    requirements: [
      "Advertised prices should reflect the price a customer will actually pay, apart from government charges",
      "Optional products are accepted or declined by the customer, and shown as installed or optional",
    ],
    applies: "Price integrity check, addendum signing, Vehicle Passport price breakdown.",
  }),
  row({
    id: "fed-cars-rule",
    jurisdiction: "Federal",
    requirement: "FTC CARS Rule (vacated)",
    type: "Law",
    source: "Fifth Circuit, No. 24-60013, January 27, 2025",
    workflow: "Marketing copy",
    summary: "The Fifth Circuit vacated the FTC CARS Rule. AutoLabels does not claim compliance with it; it uses FTC-aligned and 50-state disclosure language instead.",
    requirements: ["Do not describe a document or workflow as CARS Act compliant"],
    applies: "Product and marketing copy.",
    effective: "Vacated January 27, 2025",
  }),
  row({
    id: "ca-sb766",
    jurisdiction: "California",
    requirement: "SB 766 used-car return and cost disclosure",
    type: "Law",
    source: "California SB 766 (2025)",
    sourceUrl: "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260SB766",
    workflow: "Deals",
    summary: "Signed October 6, 2025 and effective October 1, 2026. Adds a three-day return for used cars under $50,000, up-front cost disclosure, and a ban on add-ons that give the buyer no benefit.",
    requirements: [
      "Three-day return window on qualifying used-car sales under $50,000",
      "Up-front disclosure of costs",
      "No charge for add-ons that provide no benefit to the buyer",
    ],
    applies: "Deals (return window), addendum disclosures. Confirm scope and thresholds against the enacted text.",
    effective: "October 1, 2026",
  }),
  row({
    id: "ca-docfee",
    jurisdiction: "California",
    requirement: "Documentation fee cap",
    type: "Law",
    source: "California Vehicle Code, documentary service fee provisions",
    workflow: "Addendum",
    summary: "The California documentary fee cap stays at $85. A proposed raise (SB 791) was vetoed.",
    requirements: ["Doc fee on a California sale does not exceed $85"],
    applies: "Doc fee line on the addendum and the fee-inclusive price derivation.",
  }),
  row({
    id: "ct-k208",
    jurisdiction: "Connecticut",
    requirement: "Form K-208 safety inspection",
    type: "Law",
    source: "Conn. Gen. Stat. 14-62(g)",
    workflow: "Prep and K-208",
    summary: "A Connecticut licensed dealer documents the safety inspection of a used vehicle on Form K-208 before sale.",
    requirements: [
      "Complete the inspection on the K-208 form",
      "File the executed form with the deal record",
    ],
    applies: "Vehicle file Compliance tab, Prep sign-off. The form is produced and certified under the store's own policy.",
  }),
  row({
    id: "prod-price-integrity",
    jurisdiction: "AutoLabels",
    requirement: "Price integrity before signing",
    type: "Product check",
    source: "AutoLabels price verification",
    workflow: "Deals",
    summary: "The server compares the addendum price with the advertised price. A mismatch blocks customer signing until it is resolved with evidence.",
    requirements: [
      "A deal with a price mismatch cannot be signed around",
      "Resolving a price opens the evidence review and never overwrites silently",
    ],
    applies: "Deals, Compliance Price Integrity.",
  }),
  row({
    id: "prod-consent",
    jurisdiction: "AutoLabels",
    requirement: "Express consent for each add-on",
    type: "Product check",
    source: "AutoLabels addendum signing",
    workflow: "Addendum",
    summary: "Each optional product is accepted or declined by the customer, marked installed or optional, and never charged without an affirmative choice.",
    requirements: [
      "Customer accepts or declines each optional product",
      "Installed and optional products are labeled separately",
      "Financing impact is shown for optional products",
    ],
    applies: "Addendum and signing flow.",
  }),
  row({
    id: "prod-sticker-addendum",
    jurisdiction: "AutoLabels",
    requirement: "Window sticker and signing addendum stay separate",
    type: "Product check",
    source: "AutoLabels document rules",
    workflow: "Vehicle Documents",
    summary: "Signatures belong on the signing addendum, not on the window sticker that stays on the vehicle.",
    requirements: ["No signature block on the window sticker", "The addendum carries consent and signatures"],
    applies: "Window sticker generator, addendum.",
  }),
  row({
    id: "dealer-adoption",
    jurisdiction: "Dealer",
    requirement: "Legal review and adoption of disclosures",
    type: "Dealer policy",
    source: "Dealer legal adoption agreement",
    workflow: "Administration",
    summary: "The dealership is given the opportunity to have its counsel review disclosure language, and adopts the standard language if it proceeds without changes. AutoLabels is not a law firm and does not give legal advice.",
    requirements: [
      "Have counsel review disclosure and addendum wording",
      "Submit any wording changes before relying on the templates",
    ],
    applies: "Addendum templates and disclosure language.",
  }),
];

export const stateRows = (code: string): LibraryRow[] => {
  const c: StateCompliance = getStateCompliance(code);
  if (!c.stateName) return [];
  const rows: LibraryRow[] = [];
  if (c.docFeeDisclosures.length || c.docFeeMaxCap !== null) {
    rows.push(
      row({
        id: `state-${c.stateCode.toLowerCase()}-docfee`,
        jurisdiction: c.stateName,
        requirement: `${c.docFeeTerminology} disclosures`,
        type: "Law",
        source: "AutoLabels state rules (citation not recorded)",
        workflow: "Addendum",
        summary: `How ${c.stateName} wants the dealer fee named and disclosed on the addendum${c.docFeeMaxCap !== null ? `, with a cap of $${c.docFeeMaxCap}` : ""}.`,
        requirements: c.docFeeDisclosures,
        applies: "Doc fee line on the addendum. Verify against the official state source.",
      }),
    );
  }
  rows.push(
    row({
      id: `state-${c.stateCode.toLowerCase()}-retention`,
      jurisdiction: c.stateName,
      requirement: "Record retention",
      type: "Product check",
      source: "AutoLabels state rules (citation not recorded)",
      workflow: "Deals",
      summary: `Signed addendums and compliance records are kept for at least ${c.recordRetentionYears} years.`,
      requirements: [`Retain signed addendums and customer interaction records for ${c.recordRetentionYears} years`],
      applies: "Signed document storage.",
    }),
  );
  return rows;
};

export const libraryRows = (dealerStateCode: string | null | undefined): LibraryRow[] => {
  const code = (dealerStateCode || "").toUpperCase().trim();
  const extra = code ? stateRows(code) : [];
  const rows = [...FEDERAL_AND_PRODUCT_ROWS, ...extra];
  const order = (r: LibraryRow) => (r.jurisdiction === "Federal" ? 0 : r.jurisdiction === "AutoLabels" ? 3 : r.jurisdiction === "Dealer" ? 4 : 1);
  return rows.map((r, i) => ({ r, i })).sort((a, b) => order(a.r) - order(b.r) || a.i - b.i).map((x) => x.r);
};

export interface LibraryFilter {
  jurisdiction: string;
  type: string;
  query: string;
}

export const ALL = "all";

export const filterLibrary = (rows: LibraryRow[], f: LibraryFilter): LibraryRow[] => {
  const needle = f.query.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.jurisdiction !== ALL && r.jurisdiction !== f.jurisdiction) return false;
    if (f.type !== ALL && r.type !== f.type) return false;
    if (!needle) return true;
    return `${r.requirement} ${r.source} ${r.jurisdiction} ${r.workflow} ${r.summary}`.toLowerCase().includes(needle);
  });
};
