import {
  isThirdPartyItem,
  itemDepartment,
  vendorsFor,
  type GetReadyItem,
  type GetReadyVendor,
} from "@/hooks/useGetReady";

// Which department column a get-ready line is displayed under. Vendor first
// (explicit department or accessory category), then service, then prep.
// Anything else falls back to its routed department so no line is dropped.
export function columnFor(item: GetReadyItem): "service" | "prep" | "vendor" {
  if (itemDepartment(item) === "vendor" || item.category === "accessory") return "vendor";
  if (item.category === "inspection" || item.category === "service") return "service";
  if (item.category === "detail" || item.category === "photo") return "prep";
  return itemDepartment(item) === "service" ? "service" : "prep";
}

// Third-party identity is a property of the row, never of the column it is
// displayed in: columnFor() routes every `category === "accessory"` line into
// the Vendors & Accessories column, including door-edge guards the store's own
// detail department installs on an internal RO. It is defined beside
// GetReadyItem so the dispatch path and the display path cannot drift apart
// again; re-exported here because the column model is where callers look for it.
export { isThirdPartyItem };

// The vendor LIST is one function too, for the same reason and defined in the
// same place: Vendor Assignments on screen 2 and deriveGetReadyDispatch's
// recipient set are the same set of vendors, narrowed by name (`.pending` +
// an email) rather than re-derived from a different field.
export { vendorsFor };
export type { GetReadyVendor };

// One rule for every dealer-cost figure on the screen, so the per-column
// "Estimated Cost" lines and the rail's "Estimated Total Cost" cannot disagree.
export function sumItemCosts(items: GetReadyItem[]): number | null {
  const costed = items.filter((i) => typeof i.cost === "number" && Number.isFinite(i.cost));
  if (costed.length === 0) return null;
  return costed.reduce((sum, i) => sum + (i.cost as number), 0);
}

// Where the get-ready stands, as the stepper numbers it. Both command surfaces
// derive it here: screen 1's green "Ready to Market" is the same claim as
// screen 2's step 4, and they used to be computed by different rules.
//   1 — reviewed but not authorized
//   3 — authorized and dispatched, work outstanding
//   4 — authorized and every work item complete
export function getReadyStep(args: { dispatched: boolean; items: GetReadyItem[] }): 1 | 3 | 4 {
  const { dispatched, items } = args;
  if (!dispatched) return 1;
  return items.length > 0 && items.every((i) => i.status === "complete") ? 4 : 3;
}
