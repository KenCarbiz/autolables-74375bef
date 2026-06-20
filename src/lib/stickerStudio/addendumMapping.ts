import type { StickerLineItem } from "./templates";

// ──────────────────────────────────────────────────────────────────────
// Map an addendum products_snapshot (the same model the signing flow uses) to
// Sticker Studio line items, applying the signing flow's pricing language so a
// printed addendum can never contradict the signed packet:
//
//   installed + price_in_advertised !== false  -> Installed Equipment, itemized
//      WITHOUT a price (already inside the advertised vehicle price; not re-added)
//   installed + price_in_advertised === false   -> Installed Equipment, PRICED
//      (added-above-advertised; additive to the total, disclosed)
//   optional                                    -> Available Upgrades (not in
//      total unless the customer selects it)
//   price <= 0 / benefit                        -> Included Benefits
// ──────────────────────────────────────────────────────────────────────

export interface SnapshotProduct {
  id?: string;
  name: string;
  price?: number;
  badge_type?: "installed" | "optional" | string;
  price_in_advertised?: boolean;
  mandatory?: boolean;
  disclosure?: string;
  benefit_justification?: string;
}

export interface MappedAddendum {
  installed: StickerLineItem[];
  upgrades: StickerLineItem[];
  benefits: StickerLineItem[];
  // Pricing roll-up consistent with the signing flow.
  aboveAdvertisedTotal: number; // additive installed (price_in_advertised === false)
  includedInstalledCount: number;
  optionalTotal: number;        // not added unless selected
}

const isInstalled = (p: SnapshotProduct) => p.badge_type === "installed";
const isOptional = (p: SnapshotProduct) => p.badge_type === "optional";
const aboveAdvertised = (p: SnapshotProduct) => isInstalled(p) && p.price_in_advertised === false;
const priceStr = (n?: number) => (typeof n === "number" && n > 0 ? String(n) : "");

export function mapProductsToStickerItems(products: SnapshotProduct[] | null | undefined): MappedAddendum {
  const list = Array.isArray(products) ? products.filter((p) => (p?.name || "").trim()) : [];
  const installed: StickerLineItem[] = [];
  const upgrades: StickerLineItem[] = [];
  const benefits: StickerLineItem[] = [];
  let aboveAdvertisedTotal = 0;
  let includedInstalledCount = 0;
  let optionalTotal = 0;

  for (const p of list) {
    const price = typeof p.price === "number" ? p.price : 0;
    if (isInstalled(p)) {
      if (aboveAdvertised(p)) {
        // Added above advertised — priced + additive, flagged for disclosure.
        installed.push({ name: p.name, price: priceStr(price), note: "above advertised" });
        aboveAdvertisedTotal += price;
      } else if (price > 0) {
        // Included in advertised price — itemize WITHOUT a price (not re-added).
        installed.push({ name: p.name, note: "included" });
        includedInstalledCount += 1;
      } else {
        benefits.push({ name: p.name });
      }
    } else if (isOptional(p)) {
      upgrades.push({ name: p.name, price: priceStr(price) });
      optionalTotal += price;
    } else if (price <= 0) {
      benefits.push({ name: p.name });
    } else {
      // Unknown disposition with a price — treat conservatively as optional.
      upgrades.push({ name: p.name, price: priceStr(price) });
      optionalTotal += price;
    }
  }

  return { installed, upgrades, benefits, aboveAdvertisedTotal, includedInstalledCount, optionalTotal };
}
