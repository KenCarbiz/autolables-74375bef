import { itemDepartment, type GetReadyItem } from "@/hooks/useGetReady";

// Which department column a get-ready line is displayed under. Vendor first
// (explicit department or accessory category), then service, then prep.
// Anything else falls back to its routed department so no line is dropped.
export function columnFor(item: GetReadyItem): "service" | "prep" | "vendor" {
  if (itemDepartment(item) === "vendor" || item.category === "accessory") return "vendor";
  if (item.category === "inspection" || item.category === "service") return "service";
  if (item.category === "detail" || item.category === "photo") return "prep";
  return itemDepartment(item) === "service" ? "service" : "prep";
}

// Whether the line is work a THIRD PARTY performs, which is what "Pending Proof"
// and the five-business-day proof clock actually mean.
//
// This is a property of the row, never of the column it is displayed in:
// columnFor() routes every `category === "accessory"` line into the Vendors &
// Accessories column, including door-edge guards the store's own detail
// department installs on an internal RO. Reading the column back as the answer
// billed in-house work as vendor work owing proof it will never upload.
//
// installMethod is the row's own statement about who does the work, so it wins.
// Otherwise an explicit vendor department, then an actual vendor assignment.
export function isThirdPartyItem(item: GetReadyItem): boolean {
  if (item.installMethod === "third_party_check_request") return true;
  if (item.installMethod === "internal_ro") return false;
  if (itemDepartment(item) === "vendor") return true;
  return !!(item.vendorName || item.vendorEmail || item.checkRequest);
}

// One rule for every dealer-cost figure on the screen, so the per-column
// "Estimated Cost" lines and the rail's "Estimated Total Cost" cannot disagree.
export function sumItemCosts(items: GetReadyItem[]): number | null {
  const costed = items.filter((i) => typeof i.cost === "number" && Number.isFinite(i.cost));
  if (costed.length === 0) return null;
  return costed.reduce((sum, i) => sum + (i.cost as number), 0);
}
