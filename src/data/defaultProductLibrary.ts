// ──────────────────────────────────────────────────────────────
// Default Product Library — starter catalog seeded into a
// dealership's local product library on first load so the
// "Product Library" panel is useful out of the box. Each entry is
// a template the dealer can one-click "Add to dealership" to copy
// into their active products list, then price + tune per store.
//
// Disclosures + benefits are written FTC-aligned (genuine consumer
// benefit, no "junk fee" framing). Prices are conservative market
// placeholders the dealer is expected to override.
// ──────────────────────────────────────────────────────────────

import type { ProductLibraryEntry } from "@/types/product";
import { emptyProductLibraryEntry } from "@/types/product";

type LibrarySeed = Omit<ProductLibraryEntry, "id" | "created_at" | "updated_at">;

// Build a full seed entry from a compact spec, filling every required
// field from the empty template so the catalog stays readable.
const mk = (spec: Partial<LibrarySeed> & Pick<LibrarySeed, "name" | "category" | "subtitle" | "defaultPrice">): LibrarySeed => ({
  ...emptyProductLibraryEntry,
  ...spec,
  priceTiers: spec.priceTiers ?? [],
});

export const DEFAULT_PRODUCT_LIBRARY: LibrarySeed[] = [
  mk({
    name: "Ceramic Protection Package",
    category: "Paint Protection",
    subcategory: "Ceramic Coating",
    subtitle: "Full exterior & interior ceramic polymer coating application.",
    badge_type: "installed",
    defaultPrice: 1495,
    price_label: "Included in Selling Price",
    description:
      "A professionally applied ceramic polymer coating that bonds to the factory paint and interior surfaces to resist UV fade, oxidation, bird-dropping etching, and staining.",
    benefits: [
      "Helps preserve paint depth and gloss against UV and oxidation",
      "Makes washing easier and reduces the need for frequent waxing",
      "Adds a hydrophobic layer that helps water and contaminants bead and release",
    ],
    whyItMatters:
      "A coated finish is easier to keep clean and helps protect the vehicle's appearance and resale value over years of ownership.",
    warranty: "Limited finish warranty — see provider terms.",
    vendorName: "Dealer-applied",
    disclosure:
      "Ceramic Protection Package: a ceramic polymer coating professionally applied to the exterior paint and designated interior surfaces. This is a genuine protective treatment, not paint or a structural part. Coverage and duration are governed by the provider's written limited warranty.",
    iconType: "sparkles",
    sort_order: 1,
  }),
  mk({
    name: "Paint Protection Film (Clear Bra)",
    category: "Paint Protection",
    subcategory: "Film",
    subtitle: "Urethane film on high-impact front surfaces.",
    badge_type: "optional",
    defaultPrice: 899,
    price_label: "If Accepted",
    description:
      "A clear urethane film applied to high-impact areas such as the front bumper, hood leading edge, and mirrors to help absorb rock chips and road debris.",
    benefits: [
      "Helps shield vulnerable painted surfaces from rock chips and abrasion",
      "Many films are self-healing against fine swirl marks with heat",
      "Removable without damaging the factory finish when professionally applied",
    ],
    whyItMatters:
      "Front-end paint takes the most road damage. Film helps keep those panels looking new and avoids costly repaint work.",
    warranty: "Manufacturer film warranty — see provider terms.",
    vendorName: "Dealer-applied",
    disclosure:
      "Paint Protection Film: a clear urethane film applied to specified exterior surfaces. Coverage area and duration are governed by the film manufacturer's written warranty.",
    iconType: "shield",
    sort_order: 2,
  }),
  mk({
    name: "Window Tint",
    category: "Window",
    subcategory: "Tint",
    subtitle: "Heat- and UV-rejecting window film.",
    badge_type: "optional",
    defaultPrice: 399,
    price_label: "If Accepted",
    description:
      "Professionally installed window film that rejects heat and blocks UV, applied to legal shades for the vehicle's window positions.",
    benefits: [
      "Blocks a high percentage of UV to help protect skin and interior surfaces",
      "Rejects solar heat to help keep the cabin cooler",
      "Reduces glare for more comfortable driving",
    ],
    whyItMatters:
      "Tint improves comfort and helps protect the interior from fading while cutting glare and heat.",
    warranty: "Lifetime film warranty (typical) — see provider terms.",
    vendorName: "Dealer-applied",
    disclosure:
      "Window Tint: window film installed to shades permitted by state law for each window position. The customer is responsible for confirming local legality of any front-window application.",
    iconType: "sun",
    sort_order: 3,
  }),
  mk({
    name: "Door Edge Guard & Handle Cup Protection",
    category: "Exterior",
    subcategory: "Protection",
    subtitle: "Pre-cut door edge guards & handle cup protectors.",
    badge_type: "installed",
    defaultPrice: 299,
    price_label: "Included in Selling Price",
    description:
      "Pre-cut protective film applied to door edges and behind door handles to help prevent chips and fingernail scratches in everyday use.",
    benefits: [
      "Helps prevent chips on door edges from parking-lot contact",
      "Helps protect the paint behind handles from fingernail scratching",
      "Nearly invisible and conforms to factory contours",
    ],
    whyItMatters:
      "Door edges and handle cups are the first places everyday wear shows. This keeps them looking factory-fresh.",
    warranty: "Limited film warranty — see provider terms.",
    vendorName: "Dealer-applied",
    disclosure:
      "Door Edge Guard & Handle Cup Protection: pre-cut protective film applied to door edges and handle cups. A cosmetic protection product, not a structural component.",
    iconType: "shield",
    sort_order: 4,
  }),
  mk({
    name: "VIN Etch Theft Deterrent",
    category: "Theft Deterrent",
    subcategory: "VIN Etch",
    subtitle: "VIN etching on glass + theft deterrent registration.",
    badge_type: "optional",
    defaultPrice: 349,
    price_label: "If Accepted",
    description:
      "The vehicle identification number is permanently etched onto the glass and registered with a theft-deterrent database, making the vehicle harder to resell if stolen and parts harder to fence.",
    benefits: [
      "Permanently marks the glass, so marked parts are harder to resell and easier to trace",
      "Registration may help law enforcement identify or recover the vehicle if it is stolen",
      "Some insurers may offer a discount for VIN-etched glass; check with your provider",
    ],
    whyItMatters:
      "The mark stays with the vehicle and gives stolen parts a traceable identity if it is ever recovered.",
    warranty: "Theft-benefit program terms apply — see provider.",
    vendorName: "Dealer-applied",
    disclosure:
      "VIN Etch Theft Deterrent: permanent etching of the VIN onto vehicle glass plus registration in a theft-deterrent program. Any benefit payment is governed by the program's written terms; this is a deterrent, not a guarantee against theft.",
    iconType: "lock",
    sort_order: 5,
  }),
  mk({
    name: "Nitrogen Tire Fill",
    category: "Wheels & Tires",
    subcategory: "Tire Service",
    subtitle: "Nitrogen-filled tires with top-off service.",
    badge_type: "optional",
    defaultPrice: 149,
    price_label: "If Accepted",
    description:
      "Tires purged and filled with nitrogen, which migrates through rubber more slowly than oxygen and helps tires hold pressure longer between checks.",
    benefits: [
      "Helps tires retain pressure longer for more consistent inflation",
      "Properly inflated tires support fuel economy and even tread wear",
      "Reduces in-tire moisture and oxidation",
    ],
    whyItMatters:
      "Consistent tire pressure improves safety, tire life, and fuel economy with less maintenance.",
    warranty: "Top-off service per program terms.",
    vendorName: "Dealer-applied",
    disclosure:
      "Nitrogen Tire Fill: tires filled with nitrogen plus periodic top-off service per program terms. Routine pressure checks are still recommended.",
    iconType: "circle",
    sort_order: 6,
  }),
  mk({
    name: "Wheel & Tire Protection",
    category: "Wheels & Tires",
    subcategory: "Road Hazard",
    subtitle: "Road-hazard repair/replacement coverage.",
    badge_type: "optional",
    defaultPrice: 699,
    price_label: "If Accepted",
    description:
      "Coverage that repairs or replaces wheels and tires damaged by covered road hazards such as potholes, nails, and debris for the contract term.",
    benefits: [
      "Covers repair or replacement of road-hazard tire and wheel damage",
      "Helps avoid surprise out-of-pocket cost for pothole and debris damage",
      "Often includes mounting, balancing, and disposal",
    ],
    whyItMatters:
      "A single wheel or tire replacement can cost hundreds; this caps that risk for the term.",
    warranty: "Contract coverage — see written terms.",
    vendorName: "Third-party administrator",
    disclosure:
      "Wheel & Tire Protection: a contract that repairs or replaces wheels and tires damaged by covered road hazards. Covered events, limits, and exclusions are governed by the written contract.",
    iconType: "circle",
    sort_order: 7,
  }),
  mk({
    name: "Interior Fabric & Leather Protection",
    category: "Interior Protection",
    subcategory: "Fabric Guard",
    subtitle: "Stain-resist treatment for seats & carpet.",
    badge_type: "optional",
    defaultPrice: 399,
    price_label: "If Accepted",
    description:
      "A protective treatment applied to fabric, carpet, and leather surfaces to help resist staining and ease cleanup of spills, with a coverage plan for covered stains.",
    benefits: [
      "Helps spills bead up for easier cleanup before they set",
      "Resists staining on fabric, carpet, and leather",
      "Coverage plan helps address covered stains and damage",
    ],
    whyItMatters:
      "A protected, stain-resistant interior is easier to keep clean and helps preserve resale condition.",
    warranty: "Stain-coverage plan — see written terms.",
    vendorName: "Dealer-applied",
    disclosure:
      "Interior Fabric & Leather Protection: a protective treatment plus a covered-stain plan. Covered stains, limits, and exclusions are governed by the written plan.",
    iconType: "sparkles",
    sort_order: 8,
  }),
  mk({
    name: "All-Weather Floor Liner Set",
    category: "Convenience",
    subcategory: "Floor Liners",
    subtitle: "Custom-fit all-weather liners.",
    badge_type: "optional",
    defaultPrice: 249,
    price_label: "If Accepted",
    description:
      "Custom-fit all-weather floor liners with raised edges to help contain water, mud, snow, and spills and protect the factory carpet.",
    benefits: [
      "Helps protect factory carpet from water, mud, and salt",
      "Custom-fit with raised edges to contain spills",
      "Easy to remove and rinse clean",
    ],
    whyItMatters:
      "Protecting the carpet preserves the interior and helps resale value, especially in winter climates.",
    warranty: "Manufacturer warranty — see provider terms.",
    vendorName: "Accessory",
    disclosure:
      "All-Weather Floor Liner Set: custom-fit accessory floor liners. A physical accessory included with the vehicle when elected.",
    iconType: "layers",
    sort_order: 9,
  }),
  mk({
    name: "GAP Coverage",
    category: "Warranty & Plans",
    subcategory: "GAP",
    subtitle: "Covers the loan-to-value gap on a total loss.",
    badge_type: "optional",
    defaultPrice: 895,
    price_label: "If Accepted",
    description:
      "Guaranteed Asset Protection helps cover the difference between what is owed on the loan and the insurance settlement if the vehicle is totaled or stolen.",
    benefits: [
      "Helps cover the gap between loan balance and insurance payout",
      "Protects against owing on a vehicle you no longer have",
      "Most valuable with low down payments or longer terms",
    ],
    whyItMatters:
      "Early in a loan you can owe more than the vehicle is worth; GAP helps close that gap after a covered total loss.",
    warranty: "Coverage governed by written GAP contract.",
    vendorName: "Third-party administrator",
    disclosure:
      "GAP Coverage: an optional debt-cancellation/insurance product that addresses the difference between the loan balance and the primary insurer's settlement on a covered total loss. Coverage, caps, and exclusions are governed by the written contract. GAP is voluntary and not required to obtain financing.",
    iconType: "shield",
    sort_order: 10,
  }),
  mk({
    name: "Key Replacement Coverage",
    category: "Safety",
    subcategory: "Key Replacement",
    subtitle: "Covers lost or damaged smart keys.",
    badge_type: "optional",
    defaultPrice: 299,
    price_label: "If Accepted",
    description:
      "Coverage that pays to replace and reprogram lost, stolen, or damaged keys and key fobs for the contract term.",
    benefits: [
      "Covers costly smart-key and fob replacement and programming",
      "Avoids a large surprise bill for a single lost modern key",
      "Simple claims process per program terms",
    ],
    whyItMatters:
      "A single modern smart key can cost several hundred dollars to replace and program; this caps that risk.",
    warranty: "Contract coverage — see written terms.",
    vendorName: "Third-party administrator",
    disclosure:
      "Key Replacement Coverage: a contract that covers replacement and programming of lost, stolen, or damaged keys for the term. Limits and exclusions are governed by the written contract.",
    iconType: "key",
    sort_order: 11,
  }),
];
