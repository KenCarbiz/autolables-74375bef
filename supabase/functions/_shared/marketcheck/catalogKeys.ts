// Maps a MarketCheck request URL to the account catalog's product key
// (migration 0007), which is finer than the billing product: the three price
// endpoints are different products with different bundles.
export function catalogProductForUrl(url: string): string {
  const path = url.split("?")[0].replace(/^https?:\/\/[^/]+/, "");
  if (path.includes("/predict/car/")) {
    if (path.includes("/comparables/decode")) return "price_premium_plus";
    if (path.includes("/comparables")) return "price_premium";
    return "price_base";
  }
  if (path.includes("/decode/car/neovin/")) return "neovin";
  if (path.includes("/decode/car/")) return "basic_decode";
  if (path.includes("/history/car/")) return "vin_history";
  if (path.includes("/mds/car")) return "mds";
  if (path.includes("/search/car/recents")) return "recents";
  if (path.includes("/sales/car") || path.includes("/sold/car")) return "sales_stats";
  if (path.includes("/autorecalls/") || path.includes("/recall/car/")) return "autorecalls";
  if (path.includes("/options/") && path.includes("packages")) return "available_options_packages";
  if (path.includes("/dealerships/inventory")) return "syndication";
  if (path.includes("/dealerships/") || path.includes("/dealers/") || path.includes("/dealer/")) return "dealership_directory";
  if (path.includes("/image/cache/car/")) return "cached_images";
  if (path.includes("/search/car/active") || path.includes("/search/car/")) return "active_search";
  return "unknown";
}

/** A dedupe key for a request: product plus the request minus any credential. */
export async function requestDedupeKey(url: string, vin?: string | null): Promise<string> {
  const product = catalogProductForUrl(url);
  if (vin) return `${product}:${vin.trim().toUpperCase()}`;
  const u = new URL(url, "https://x.invalid");
  for (const k of [...u.searchParams.keys()]) if (/key|token|secret/i.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(u.pathname + "?" + u.searchParams.toString()));
  return `${product}:${[...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
